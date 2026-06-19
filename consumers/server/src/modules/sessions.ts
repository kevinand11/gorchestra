import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { v, type Pipe, type PipeOutput } from 'valleyed'

import { deleteCachedValue, getCachedJson, setCachedJson } from '../cache'
import { readServerEnv } from '../env'
import { normalizeEmailAddress } from './email-otp'

export const sessionCookieName = 'gorchestra_session'
export const sessionLifetimeSeconds = 7 * 24 * 60 * 60
export const sessionRefreshThresholdSeconds = sessionLifetimeSeconds / 2
export const previousSessionTokenGraceSeconds = 30

function nonEmptyStringPipe() {
	return v.string().pipe(v.min(1))
}

const sessionJwtPartsPipe = v
	.string()
	.pipe((token) => token.split('.'))
	.pipe(v.tuple([nonEmptyStringPipe(), nonEmptyStringPipe(), nonEmptyStringPipe()] as const))
	.pipe(([header, body, signature]) => ({ header, body, signature }))

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
	previousToken?: string
	previousTokenGraceExpiresAt?: number
}

type SessionTokenStatus = 'current' | 'previous-grace'

type JwtParts = PipeOutput<typeof sessionJwtPartsPipe>

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
	userId: string
	email: string
	now?: Date
	signingKey?: string
	generateSessionId?: () => string
}

export type CreateSessionResult = {
	token: string
	session: ServerSession
	cookie: ServerSessionCookie
}

export type VerifySessionTokenInput = {
	token?: string | null
	now?: Date
	signingKey?: string
}

export type VerifySessionTokenResult =
	| { authenticated: true; session: ServerSession; tokenStatus: 'current' | 'previous-grace'; refreshRecommended: boolean }
	| { authenticated: false; reason: 'missing-token' | 'invalid-token' | 'expired' | 'not-current' }

export type RefreshSessionTokenInput = {
	token: string
	now?: Date
	signingKey?: string
	generateSessionId?: () => string
}

export type RefreshSessionTokenResult =
	| { refreshed: true; token: string; session: ServerSession; cookie: ServerSessionCookie }
	| { refreshed: false; reason: 'not-authenticated' | 'previous-token-grace' }

export type RevokeSessionInput = {
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
	const token = signSessionJwt(payload, getSigningKey(input.signingKey))
	await storeSessionTokens({ currentToken: token, currentExpiresAt: payload.exp, userId: payload.sub, ...getOptionalNow(input.now) })
	return { token, session: sessionFromPayload(payload), cookie: buildSessionCookie(token) }
}

export async function verifySessionToken(input: VerifySessionTokenInput): Promise<VerifySessionTokenResult> {
	const payloadLookup = getVerifiedSessionPayload(input)
	if (!payloadLookup.verified) return { authenticated: false, reason: payloadLookup.reason }

	const cachedSession = await getCachedJson<CachedServerSession>(getSessionCacheKey(payloadLookup.payload.sub))
	const tokenStatus = getSessionTokenStatus(payloadLookup.token, cachedSession, input.now)
	if (!tokenStatus) return { authenticated: false, reason: 'not-current' }

	const session = sessionFromPayload(payloadLookup.payload)
	return { authenticated: true, session, tokenStatus, refreshRecommended: shouldRefreshSession(session, input.now) }
}

export async function refreshSessionToken(input: RefreshSessionTokenInput): Promise<RefreshSessionTokenResult> {
	const verified = await verifySessionToken(input)
	if (!verified.authenticated) return { refreshed: false, reason: 'not-authenticated' }
	if (verified.tokenStatus === 'previous-grace') return { refreshed: false, reason: 'previous-token-grace' }

	const refreshed = await createRefreshedSession({ ...input, session: verified.session })
	return { refreshed: true, ...refreshed }
}

export async function revokeSession(input: RevokeSessionInput): Promise<void> {
	await deleteCachedValue(getSessionCacheKey(requireUserId(input.userId)))
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

export function shouldRefreshSession(session: ServerSession, now = new Date()): boolean {
	const remainingSeconds = Math.ceil((Date.parse(session.expiresAt) - now.getTime()) / 1000)
	return remainingSeconds > 0 && remainingSeconds < sessionRefreshThresholdSeconds
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
	const token = signSessionJwt(payload, getSigningKey(input.signingKey))
	await storeSessionTokens({
		currentToken: token,
		currentExpiresAt: payload.exp,
		previousToken: input.token,
		previousTokenGraceExpiresAt: (input.now ?? new Date()).getTime() + previousSessionTokenGraceSeconds * 1000,
		userId: payload.sub,
		...getOptionalNow(input.now),
	})
	return { token, session: sessionFromPayload(payload), cookie: buildSessionCookie(token) }
}

async function storeSessionTokens(input: {
	currentToken: string
	currentExpiresAt: number
	previousToken?: string
	previousTokenGraceExpiresAt?: number
	userId: string
	now?: Date
}): Promise<void> {
	const cachedSession: CachedServerSession = { currentToken: input.currentToken }
	if (input.previousToken && input.previousTokenGraceExpiresAt) {
		cachedSession.previousToken = input.previousToken
		cachedSession.previousTokenGraceExpiresAt = input.previousTokenGraceExpiresAt
	}
	await setCachedJson(getSessionCacheKey(input.userId), cachedSession, getCacheTtlSeconds(input.currentExpiresAt, input.now))
}

function getVerifiedSessionPayload(
	input: VerifySessionTokenInput,
):
	| { verified: true; token: string; payload: SessionJwtPayload }
	| { verified: false; reason: 'missing-token' | 'invalid-token' | 'expired' } {
	if (!input.token) return { verified: false, reason: 'missing-token' }
	const payloadLookup = verifySessionJwt(input.token, getSigningKey(input.signingKey))
	if (!payloadLookup.verified) return payloadLookup
	return isExpiredSessionPayload(payloadLookup.payload, input.now)
		? { verified: false, reason: 'expired' }
		: { ...payloadLookup, token: input.token }
}

function getSessionTokenStatus(token: string, cachedSession: CachedServerSession | null, now = new Date()): SessionTokenStatus | null {
	if (!cachedSession) return null
	if (isCurrentSessionToken(token, cachedSession)) return 'current'
	return isPreviousGraceSessionToken(token, cachedSession, now) ? 'previous-grace' : null
}

function isCurrentSessionToken(token: string, cachedSession: CachedServerSession): boolean {
	return token === cachedSession.currentToken
}

function isPreviousGraceSessionToken(token: string, cachedSession: CachedServerSession, now: Date): boolean {
	return token === cachedSession.previousToken && (cachedSession.previousTokenGraceExpiresAt ?? 0) > now.getTime()
}

function isExpiredSessionPayload(payload: SessionJwtPayload, now?: Date): boolean {
	return payload.exp <= getEpochSeconds(now)
}

function signSessionJwt(payload: SessionJwtPayload, signingKey: string): string {
	const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' })
	const body = encodeJwtPart(payload)
	const unsignedToken = `${header}.${body}`
	return `${unsignedToken}.${signJwtValue(unsignedToken, signingKey)}`
}

function verifySessionJwt(
	token: string,
	signingKey: string,
): { verified: true; payload: SessionJwtPayload } | { verified: false; reason: 'invalid-token' } {
	const parts = parseJwtParts(token)
	if (!parts) return { verified: false, reason: 'invalid-token' }
	if (!hasValidJwtSignature(parts, signingKey)) return { verified: false, reason: 'invalid-token' }
	return getDecodedSessionJwtLookup(parts.body)
}

function parseJwtParts(token: string): JwtParts | null {
	return parseWithPipe(sessionJwtPartsPipe, token)
}

function hasValidJwtSignature(parts: JwtParts, signingKey: string): boolean {
	return timingSafeEqualText(parts.signature, signJwtValue(`${parts.header}.${parts.body}`, signingKey))
}

function getDecodedSessionJwtLookup(
	encodedBody: string,
): { verified: true; payload: SessionJwtPayload } | { verified: false; reason: 'invalid-token' } {
	const payload = decodeSessionJwtPayload(encodedBody)
	return payload ? { verified: true, payload } : { verified: false, reason: 'invalid-token' }
}

function encodeJwtPart(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeSessionJwtPayload(encoded: string): SessionJwtPayload | null {
	return parseWithPipe(sessionJwtPayloadPipe, Buffer.from(encoded, 'base64url').toString('utf8'))
}

function parseWithPipe<T extends Pipe<unknown, unknown>>(pipe: T, input: unknown): PipeOutput<T> | null {
	const parsed = v.validate(pipe, input)
	return parsed.valid ? parsed.value : null
}

function signJwtValue(value: string, signingKey: string): string {
	return createHmac('sha256', signingKey).update(value).digest('base64url')
}

function timingSafeEqualText(a: string, b: string): boolean {
	const left = Buffer.from(a)
	const right = Buffer.from(b)
	return left.length === right.length && timingSafeEqual(left, right)
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

function getSigningKey(signingKey?: string): string {
	return signingKey ?? readServerEnv().GORCHESTRA_SESSION_JWT_SIGNING_KEY
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

function getEpochSeconds(now = new Date()): number {
	return Math.floor(now.getTime() / 1000)
}

function getOptionalNow(now: Date | undefined): { now: Date } | Record<string, never> {
	return now ? { now } : {}
}

function getCacheTtlSeconds(expiresAt: number, now = new Date()): number {
	return Math.max(1, expiresAt - getEpochSeconds(now))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const signingKey = 'test-session-signing-key'
	const testNow = new Date('2026-06-19T00:00:00.000Z')

	function uniqueUserId(): string {
		return `user-${crypto.randomUUID()}`
	}

	function sessionInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
		return {
			userId: uniqueUserId(),
			email: '  Person+Ops@Example.COM  ',
			now: testNow,
			signingKey,
			generateSessionId: () => crypto.randomUUID(),
			...overrides,
		}
	}

	async function testCreateAndVerifySession(): Promise<void> {
		const created = await createSession(sessionInput({ generateSessionId: () => 'session-1' }))
		const verified = await verifySessionToken({ token: created.token, now: testNow, signingKey })

		expect(created.session).toEqual({
			userId: created.session.userId,
			email: 'person+ops@example.com',
			sessionId: 'session-1',
			issuedAt: '2026-06-19T00:00:00.000Z',
			expiresAt: '2026-06-26T00:00:00.000Z',
		})
		expect(verified).toEqual({ authenticated: true, session: created.session, tokenStatus: 'current', refreshRecommended: false })
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
		const userId = uniqueUserId()
		const secondSessionStart = new Date(testNow.getTime() + 1000)
		const first = await createSession(sessionInput({ userId, generateSessionId: () => 'first-session' }))
		const second = await createSession(sessionInput({ userId, now: secondSessionStart, generateSessionId: () => 'second-session' }))

		expect(await verifySessionToken({ token: first.token, now: secondSessionStart, signingKey })).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
		expect(await verifySessionToken({ token: second.token, now: secondSessionStart, signingKey })).toEqual({
			authenticated: true,
			session: second.session,
			tokenStatus: 'current',
			refreshRecommended: false,
		})
	}

	async function testRevokesSession(): Promise<void> {
		const created = await createSession(sessionInput())
		await revokeSession({ userId: created.session.userId })

		expect(await verifySessionToken({ token: created.token, now: testNow, signingKey })).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
	}

	async function testRejectsInvalidAndExpiredTokens(): Promise<void> {
		const created = await createSession(sessionInput())
		const afterExpiry = new Date(testNow.getTime() + sessionLifetimeSeconds * 1000)

		expect(await verifySessionToken({ token: `${created.token}x`, now: testNow, signingKey })).toEqual({
			authenticated: false,
			reason: 'invalid-token',
		})
		expect(await verifySessionToken({ token: created.token, now: afterExpiry, signingKey })).toEqual({
			authenticated: false,
			reason: 'expired',
		})
	}

	async function testRefreshDecisionAndGraceWindow(): Promise<void> {
		const userId = uniqueUserId()
		const created = await createSession(sessionInput({ userId, generateSessionId: () => 'initial-session' }))
		const afterRefreshThreshold = new Date(testNow.getTime() + 4 * 24 * 60 * 60 * 1000)

		expect(await verifySessionToken({ token: created.token, now: afterRefreshThreshold, signingKey })).toEqual({
			authenticated: true,
			session: created.session,
			tokenStatus: 'current',
			refreshRecommended: true,
		})

		const refreshed = await refreshSessionToken({
			token: created.token,
			now: afterRefreshThreshold,
			signingKey,
			generateSessionId: () => 'refreshed-session',
		})
		expect(refreshed.refreshed).toBe(true)
		if (!refreshed.refreshed) return
		expect(refreshed.session).toMatchObject({ userId, email: created.session.email, sessionId: 'refreshed-session' })
		expect(
			await verifySessionToken({ token: created.token, now: new Date(afterRefreshThreshold.getTime() + 29_000), signingKey }),
		).toEqual({
			authenticated: true,
			session: created.session,
			tokenStatus: 'previous-grace',
			refreshRecommended: true,
		})
		expect(
			await refreshSessionToken({ token: created.token, now: new Date(afterRefreshThreshold.getTime() + 29_000), signingKey }),
		).toEqual({
			refreshed: false,
			reason: 'previous-token-grace',
		})
		expect(
			await verifySessionToken({ token: created.token, now: new Date(afterRefreshThreshold.getTime() + 31_000), signingKey }),
		).toEqual({
			authenticated: false,
			reason: 'not-current',
		})
		expect(
			await verifySessionToken({ token: refreshed.token, now: new Date(afterRefreshThreshold.getTime() + 31_000), signingKey }),
		).toEqual({
			authenticated: true,
			session: refreshed.session,
			tokenStatus: 'current',
			refreshRecommended: false,
		})
	}

	describe('Server Sessions', () => {
		it('creates a cache-confirmed Session JWT and secure HTTP-only cookie metadata', testCreateAndVerifySession)
		it('allows only one active Session per User', testOneActiveSessionPerUser)
		it('revokes a Session by deleting its cache confirmation', testRevokesSession)
		it('rejects invalid and expired Session JWTs', testRejectsInvalidAndExpiredTokens)
		it('recommends rolling refresh and accepts the previous JWT during the grace window', testRefreshDecisionAndGraceWindow)
	})
}
