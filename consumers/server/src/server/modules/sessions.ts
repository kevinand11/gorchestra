import { randomUUID } from 'node:crypto'

import { v, type PipeOutput } from 'valleyed'

import type { ServerCache } from '../cache'
import { signJwtPayload, verifySignedJwtPayload } from '../signed-jwt'
import { normalizeEmailAddress } from './email-otp'

export const sessionCookieName = 'gorchestra_session'
export const sessionLifetimeSeconds = 7 * 24 * 60 * 60
export const sessionRefreshThresholdSeconds = 24 * 60 * 60

function nonEmptyStringPipe() {
	return v.string().pipe(v.min(1))
}

const sessionJwtPayloadPipe = v
	.fromJson(
		v.object({
			typ: v.is('gorchestra-session'),
			sub: nonEmptyStringPipe(),
			email: nonEmptyStringPipe(),
			sid: nonEmptyStringPipe(),
			iat: v.number().pipe(v.int()),
			exp: v.number().pipe(v.int()),
		}),
	)
	.pipe(v.custom((payload) => payload.exp > payload.iat, 'Session JWT expiry must be after issue time'))

type SessionJwtPayload = PipeOutput<typeof sessionJwtPayloadPipe>

type CachedServerSession = {
	currentToken: string
}

export type ServerSession = {
	userId: string
	email: string
	sessionId: string
	issuedAt: string
	expiresAt: string
}

export type ServerSessionCookie = {
	name: typeof sessionCookieName
	value: string
	path: '/'
	httpOnly: true
	secure: true
	sameSite: 'lax'
	maxAge?: number
	expires?: Date
}

export type CreateSessionInput = {
	serverCache: ServerCache
	userId: string
	email: string
	now: Date
	signingKey: string
	generateSessionId?: () => string
}

export type CreateSessionResult = {
	token: string
	session: ServerSession
	cookie: ServerSessionCookie
}

export type VerifySessionTokenInput = {
	serverCache: ServerCache
	token?: string | null
	now: Date
	signingKey: string
}

export type VerifySessionTokenResult =
	| { authenticated: true; session: ServerSession; refreshRecommended: boolean }
	| { authenticated: false; reason: 'missing-token' | 'invalid-token' | 'expired' | 'not-current' }

export type RefreshSessionTokenInput = {
	serverCache: ServerCache
	token: string
	now: Date
	signingKey: string
	generateSessionId?: () => string
}

export type RefreshSessionTokenResult =
	| { refreshed: true; token: string; session: ServerSession; cookie: ServerSessionCookie }
	| { refreshed: false; reason: 'not-authenticated' }

export type RevokeSessionInput = {
	serverCache: ServerCache
	userId: string
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const issuedAt = getEpochSeconds(input.now)
	const payload: SessionJwtPayload = {
		typ: 'gorchestra-session',
		sub: requireUserId(input.userId),
		email: requireEmail(input.email),
		sid: input.generateSessionId?.() ?? randomUUID(),
		iat: issuedAt,
		exp: issuedAt + sessionLifetimeSeconds,
	}
	const token = signSessionJwt(payload, input.signingKey)
	await storeSessionTokens({
		serverCache: input.serverCache,
		currentToken: token,
		currentExpiresAt: payload.exp,
		userId: payload.sub,
		now: input.now,
	})
	return { token, session: sessionFromPayload(payload), cookie: buildSessionCookie(token) }
}

export async function verifySessionToken(input: VerifySessionTokenInput): Promise<VerifySessionTokenResult> {
	const payloadLookup = getVerifiedSessionPayload(input)
	if (!payloadLookup.verified) return { authenticated: false, reason: payloadLookup.reason }

	const cachedSession = await input.serverCache.getJson<CachedServerSession>(getSessionCacheKey(payloadLookup.payload.sub))
	if (!isCurrentSessionToken(payloadLookup.token, cachedSession)) return { authenticated: false, reason: 'not-current' }

	const session = sessionFromPayload(payloadLookup.payload)
	return { authenticated: true, session, refreshRecommended: shouldRefreshSession(session, input.now) }
}

export async function refreshSessionToken(input: RefreshSessionTokenInput): Promise<RefreshSessionTokenResult> {
	const verified = await verifySessionToken(input)
	if (!verified.authenticated) return { refreshed: false, reason: 'not-authenticated' }

	const refreshed = await createRefreshedSession({ ...input, session: verified.session })
	return { refreshed: true, ...refreshed }
}

export async function revokeSession(input: RevokeSessionInput): Promise<void> {
	await input.serverCache.deleteValue(getSessionCacheKey(requireUserId(input.userId)))
}

export function buildSessionCookie(token: string): ServerSessionCookie {
	return {
		name: sessionCookieName,
		value: token,
		maxAge: sessionLifetimeSeconds,
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
	}
}

export function buildDeleteSessionCookie(): ServerSessionCookie {
	return {
		name: sessionCookieName,
		value: '',
		expires: new Date(0),
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
	}
}

export function shouldRefreshSession(session: ServerSession, now: Date): boolean {
	const remainingSeconds = Math.ceil((Date.parse(session.expiresAt) - now.getTime()) / 1000)
	return remainingSeconds > 0 && remainingSeconds <= sessionRefreshThresholdSeconds
}

async function createRefreshedSession(input: RefreshSessionTokenInput & { session: ServerSession }): Promise<CreateSessionResult> {
	const issuedAt = getEpochSeconds(input.now)
	const payload: SessionJwtPayload = {
		typ: 'gorchestra-session',
		sub: input.session.userId,
		email: input.session.email,
		sid: input.generateSessionId?.() ?? randomUUID(),
		iat: issuedAt,
		exp: issuedAt + sessionLifetimeSeconds,
	}
	const token = signSessionJwt(payload, input.signingKey)
	await storeSessionTokens({
		serverCache: input.serverCache,
		currentToken: token,
		currentExpiresAt: payload.exp,
		userId: payload.sub,
		now: input.now,
	})
	return { token, session: sessionFromPayload(payload), cookie: buildSessionCookie(token) }
}

async function storeSessionTokens(input: {
	serverCache: ServerCache
	currentToken: string
	currentExpiresAt: number
	userId: string
	now: Date
}): Promise<void> {
	await input.serverCache.setJson(
		getSessionCacheKey(input.userId),
		{ currentToken: input.currentToken },
		getCacheTtlSeconds(input.currentExpiresAt, input.now),
	)
}

function getVerifiedSessionPayload(
	input: VerifySessionTokenInput,
):
	| { verified: true; token: string; payload: SessionJwtPayload }
	| { verified: false; reason: 'missing-token' | 'invalid-token' | 'expired' } {
	if (!input.token) return { verified: false, reason: 'missing-token' }
	const payloadLookup = verifySessionJwt(input.token, input.signingKey)
	if (!payloadLookup.verified) return payloadLookup
	return isExpiredSessionPayload(payloadLookup.payload, input.now)
		? { verified: false, reason: 'expired' }
		: { ...payloadLookup, token: input.token }
}

function isCurrentSessionToken(token: string, cachedSession: CachedServerSession | null): boolean {
	return token === cachedSession?.currentToken
}

function isExpiredSessionPayload(payload: SessionJwtPayload, now: Date): boolean {
	return payload.exp <= getEpochSeconds(now)
}

function signSessionJwt(payload: SessionJwtPayload, signingKey: string): string {
	return signJwtPayload(payload, signingKey)
}

function verifySessionJwt(
	token: string,
	signingKey: string,
): { verified: true; payload: SessionJwtPayload } | { verified: false; reason: 'invalid-token' } {
	const payload = verifySignedJwtPayload({ token, signingKey, payloadPipe: sessionJwtPayloadPipe })
	return payload ? { verified: true, payload } : { verified: false, reason: 'invalid-token' }
}

function sessionFromPayload(payload: SessionJwtPayload): ServerSession {
	return {
		userId: payload.sub,
		email: payload.email,
		sessionId: payload.sid,
		issuedAt: new Date(payload.iat * 1000).toISOString(),
		expiresAt: new Date(payload.exp * 1000).toISOString(),
	}
}

function requireUserId(userId: string): string {
	if (!userId.trim()) throw new Error('Session User id is required')
	return userId
}

function requireEmail(email: string): string {
	const normalizedEmail = normalizeEmailAddress(email)
	if (!normalizedEmail.includes('@')) throw new Error('Session email is required')
	return normalizedEmail
}

function getSessionCacheKey(userId: string): string {
	return `session:user:${encodeURIComponent(userId)}`
}

function getEpochSeconds(now: Date): number {
	return Math.floor(now.getTime() / 1000)
}

function getCacheTtlSeconds(expiresAt: number, now: Date): number {
	return Math.max(1, expiresAt - getEpochSeconds(now))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')

	const signingKey = 'test-session-signing-key'
	const testNow = new Date('2026-06-19T00:00:00.000Z')

	function uniqueUserId(): string {
		return `user-${crypto.randomUUID()}`
	}

	function sessionInput(serverCache: ServerCache, overrides: Partial<Omit<CreateSessionInput, 'serverCache'>> = {}): CreateSessionInput {
		return {
			serverCache,
			userId: uniqueUserId(),
			email: '  Person+Ops@Example.COM  ',
			now: testNow,
			signingKey,
			generateSessionId: () => crypto.randomUUID(),
			...overrides,
		}
	}

	async function testCreateAndVerifySession(): Promise<void> {
		const serverCache = createTestServerCache()
		const created = await createSession(sessionInput(serverCache, { generateSessionId: () => 'session-1' }))
		const verified = await verifySessionToken({ serverCache, token: created.token, now: testNow, signingKey })

		expect(created.session).toEqual({
			userId: created.session.userId,
			email: 'person+ops@example.com',
			sessionId: 'session-1',
			issuedAt: '2026-06-19T00:00:00.000Z',
			expiresAt: '2026-06-26T00:00:00.000Z',
		})
		expect(verified).toEqual({ authenticated: true, session: created.session, refreshRecommended: false })
		expect(created.cookie).toMatchObject({
			name: sessionCookieName,
			value: created.token,
			maxAge: sessionLifetimeSeconds,
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
		})
	}

	async function testOneActiveSessionPerUser(): Promise<void> {
		const serverCache = createTestServerCache()
		const userId = uniqueUserId()
		const secondSessionStart = new Date(testNow.getTime() + 1000)
		const first = await createSession(sessionInput(serverCache, { userId, generateSessionId: () => 'first-session' }))
		const second = await createSession(
			sessionInput(serverCache, { userId, now: secondSessionStart, generateSessionId: () => 'second-session' }),
		)

		expect(await verifySessionToken({ serverCache, token: first.token, now: secondSessionStart, signingKey })).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
		expect(await verifySessionToken({ serverCache, token: second.token, now: secondSessionStart, signingKey })).toEqual({
			authenticated: true,
			session: second.session,
			refreshRecommended: false,
		})
	}

	async function testRevokesSession(): Promise<void> {
		const serverCache = createTestServerCache()
		const created = await createSession(sessionInput(serverCache))
		await revokeSession({ serverCache, userId: created.session.userId })

		expect(await verifySessionToken({ serverCache, token: created.token, now: testNow, signingKey })).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
	}

	async function testRejectsInvalidAndExpiredTokens(): Promise<void> {
		const serverCache = createTestServerCache()
		const created = await createSession(sessionInput(serverCache))
		const afterExpiry = new Date(testNow.getTime() + sessionLifetimeSeconds * 1000)

		expect(await verifySessionToken({ serverCache, token: `${created.token}x`, now: testNow, signingKey })).toEqual({
			authenticated: false,
			reason: 'invalid-token',
		})
		expect(await verifySessionToken({ serverCache, token: created.token, now: afterExpiry, signingKey })).toEqual({
			authenticated: false,
			reason: 'expired',
		})
	}

	async function testRefreshDecisionAndImmediateTokenReplacement(): Promise<void> {
		const serverCache = createTestServerCache()
		const userId = uniqueUserId()
		const created = await createSession(sessionInput(serverCache, { userId, generateSessionId: () => 'initial-session' }))
		const beforeRefreshThreshold = new Date(testNow.getTime() + 5 * 24 * 60 * 60 * 1000)
		const atRefreshThreshold = new Date(testNow.getTime() + 6 * 24 * 60 * 60 * 1000)

		expect(await verifySessionToken({ serverCache, token: created.token, now: beforeRefreshThreshold, signingKey })).toEqual({
			authenticated: true,
			session: created.session,
			refreshRecommended: false,
		})
		expect(await verifySessionToken({ serverCache, token: created.token, now: atRefreshThreshold, signingKey })).toEqual({
			authenticated: true,
			session: created.session,
			refreshRecommended: true,
		})

		const refreshed = await refreshSessionToken({
			serverCache,
			token: created.token,
			now: atRefreshThreshold,
			signingKey,
			generateSessionId: () => 'refreshed-session',
		})
		expect(refreshed.refreshed).toBe(true)
		if (!refreshed.refreshed) return
		expect(refreshed.session).toMatchObject({ userId, email: created.session.email, sessionId: 'refreshed-session' })
		expect(await verifySessionToken({ serverCache, token: created.token, now: atRefreshThreshold, signingKey })).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
		expect(await refreshSessionToken({ serverCache, token: created.token, now: atRefreshThreshold, signingKey })).toEqual({
			refreshed: false,
			reason: 'not-authenticated',
		})
		expect(await verifySessionToken({ serverCache, token: refreshed.token, now: atRefreshThreshold, signingKey })).toEqual({
			authenticated: true,
			session: refreshed.session,
			refreshRecommended: false,
		})
	}

	describe('Server Sessions', () => {
		it('creates a cache-confirmed Session JWT and secure HTTP-only cookie metadata', testCreateAndVerifySession)
		it('allows only one active Session per User', testOneActiveSessionPerUser)
		it('revokes a Session by deleting its cache confirmation', testRevokesSession)
		it('rejects invalid and expired Session JWTs', testRejectsInvalidAndExpiredTokens)
		it(
			'recommends rolling refresh with one day remaining and immediately replaces the previous JWT',
			testRefreshDecisionAndImmediateTokenReplacement,
		)
	})
}
