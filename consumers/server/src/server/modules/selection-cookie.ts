import { v, type PipeOutput } from 'valleyed'

import { signJwtPayload, verifySignedJwtPayload } from '../signed-jwt'

export const selectionCookieName = 'gorchestra_selection'
export const selectionLifetimeSeconds = 90 * 24 * 60 * 60

function nonEmptyStringPipe() {
	return v.string().pipe(v.min(1))
}

const selectionJwtPayloadPipe = v
	.fromJson(
		v.object({
			typ: v.is('gorchestra-selection'),
			workspaceId: nonEmptyStringPipe(),
			portfolioId: nonEmptyStringPipe(),
			iat: v.number().pipe(v.int()),
			exp: v.number().pipe(v.int()),
		}),
	)
	.pipe(v.custom((payload) => payload.exp > payload.iat, 'Selection JWT expiry must be after issue time'))

type SelectionJwtPayload = PipeOutput<typeof selectionJwtPayloadPipe>

export type SelectedPortfolio = {
	workspaceId: string
	portfolioId: string
	issuedAt: string
	expiresAt: string
}

export type ServerSelectionCookie = {
	name: typeof selectionCookieName
	value: string
	path: '/'
	httpOnly: false
	secure: true
	sameSite: 'lax'
	maxAge?: number
	expires?: Date
}

export type BuildSelectionCookieInput = {
	workspaceId: string
	portfolioId: string
	now: Date
	signingKey: string
}

export type BuildSelectionCookieResult = {
	token: string
	selection: SelectedPortfolio
	cookie: ServerSelectionCookie
}

export type VerifySelectionTokenInput = {
	token?: string | null
	now: Date
	signingKey: string
}

export type VerifySelectionTokenResult =
	| { selected: true; selection: SelectedPortfolio }
	| { selected: false; reason: 'missing-token' | 'invalid-token' | 'expired' }

export function buildSelectionCookie(input: BuildSelectionCookieInput): BuildSelectionCookieResult {
	const issuedAt = getEpochSeconds(input.now)
	const payload: SelectionJwtPayload = {
		typ: 'gorchestra-selection',
		workspaceId: requireIdentifier(input.workspaceId, 'Selected Workspace id is required'),
		portfolioId: requireIdentifier(input.portfolioId, 'Selected Portfolio id is required'),
		iat: issuedAt,
		exp: issuedAt + selectionLifetimeSeconds,
	}
	const token = signSelectionJwt(payload, input.signingKey)
	return { token, selection: selectionFromPayload(payload), cookie: buildSelectionTokenCookie(token) }
}

export function verifySelectionToken(input: VerifySelectionTokenInput): VerifySelectionTokenResult {
	const payloadLookup = getVerifiedSelectionPayload(input)
	if (!payloadLookup.verified) return { selected: false, reason: payloadLookup.reason }
	return { selected: true, selection: selectionFromPayload(payloadLookup.payload) }
}

export function buildDeleteSelectionCookie(): ServerSelectionCookie {
	return {
		name: selectionCookieName,
		value: '',
		expires: new Date(0),
		path: '/',
		httpOnly: false,
		secure: true,
		sameSite: 'lax',
	}
}

function buildSelectionTokenCookie(token: string): ServerSelectionCookie {
	return {
		name: selectionCookieName,
		value: token,
		maxAge: selectionLifetimeSeconds,
		path: '/',
		httpOnly: false,
		secure: true,
		sameSite: 'lax',
	}
}

function getVerifiedSelectionPayload(
	input: VerifySelectionTokenInput,
): { verified: true; payload: SelectionJwtPayload } | { verified: false; reason: 'missing-token' | 'invalid-token' | 'expired' } {
	if (!input.token) return { verified: false, reason: 'missing-token' }
	const payloadLookup = verifySelectionJwt(input.token, input.signingKey)
	if (!payloadLookup.verified) return payloadLookup
	return isExpiredSelectionPayload(payloadLookup.payload, input.now) ? { verified: false, reason: 'expired' } : payloadLookup
}

function signSelectionJwt(payload: SelectionJwtPayload, signingKey: string): string {
	return signJwtPayload(payload, signingKey)
}

function verifySelectionJwt(
	token: string,
	signingKey: string,
): { verified: true; payload: SelectionJwtPayload } | { verified: false; reason: 'invalid-token' } {
	const payload = verifySignedJwtPayload({ token, signingKey, payloadPipe: selectionJwtPayloadPipe })
	return payload ? { verified: true, payload } : { verified: false, reason: 'invalid-token' }
}

function selectionFromPayload(payload: SelectionJwtPayload): SelectedPortfolio {
	return {
		workspaceId: payload.workspaceId,
		portfolioId: payload.portfolioId,
		issuedAt: new Date(payload.iat * 1000).toISOString(),
		expiresAt: new Date(payload.exp * 1000).toISOString(),
	}
}

function requireIdentifier(value: string, message: string): string {
	if (!value.trim()) throw new Error(message)
	return value
}

function isExpiredSelectionPayload(payload: SelectionJwtPayload, now: Date): boolean {
	return payload.exp <= getEpochSeconds(now)
}

function getEpochSeconds(now: Date): number {
	return Math.floor(now.getTime() / 1000)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const signingKey = 'test-selection-cookie-signing-key'
	const testNow = new Date('2026-06-19T00:00:00.000Z')

	function buildTestSelection(overrides: Partial<BuildSelectionCookieInput> = {}): BuildSelectionCookieResult {
		return buildSelectionCookie({
			workspaceId: 'workspace-1',
			portfolioId: 'portfolio-1',
			now: testNow,
			signingKey,
			...overrides,
		})
	}

	function testBuildsSelectionCookie(): void {
		const built = buildTestSelection()

		expect(built.selection).toEqual({
			workspaceId: 'workspace-1',
			portfolioId: 'portfolio-1',
			issuedAt: '2026-06-19T00:00:00.000Z',
			expiresAt: '2026-09-17T00:00:00.000Z',
		})
		expect(built.cookie).toMatchObject({
			name: selectionCookieName,
			value: built.token,
			maxAge: selectionLifetimeSeconds,
			path: '/',
			httpOnly: false,
			secure: true,
			sameSite: 'lax',
		})
	}

	function testVerifiesSelectionToken(): void {
		const built = buildTestSelection()

		expect(verifySelectionToken({ token: built.token, now: testNow, signingKey })).toEqual({
			selected: true,
			selection: built.selection,
		})
	}

	function testRejectsMissingInvalidAndTamperedSelectionTokens(): void {
		const built = buildTestSelection()
		const [header, body, signature] = built.token.split('.')
		const tamperedToken = `${header}.${Buffer.from(JSON.stringify({ typ: 'gorchestra-selection', workspaceId: 'workspace-2', portfolioId: 'portfolio-1', iat: 1, exp: 2 })).toString('base64url')}.${signature}`

		expect(verifySelectionToken({ token: null, now: testNow, signingKey })).toEqual({ selected: false, reason: 'missing-token' })
		expect(verifySelectionToken({ token: `${built.token}x`, now: testNow, signingKey })).toEqual({
			selected: false,
			reason: 'invalid-token',
		})
		expect(verifySelectionToken({ token: tamperedToken, now: testNow, signingKey })).toEqual({
			selected: false,
			reason: 'invalid-token',
		})
		expect(verifySelectionToken({ token: `${header}.${body}`, now: testNow, signingKey })).toEqual({
			selected: false,
			reason: 'invalid-token',
		})
	}

	function testRejectsExpiredSelectionTokens(): void {
		const built = buildTestSelection()
		const afterExpiry = new Date(testNow.getTime() + selectionLifetimeSeconds * 1000)

		expect(verifySelectionToken({ token: built.token, now: afterExpiry, signingKey })).toEqual({
			selected: false,
			reason: 'expired',
		})
	}

	function testBuildsDeleteSelectionCookie(): void {
		expect(buildDeleteSelectionCookie()).toEqual({
			name: selectionCookieName,
			value: '',
			expires: new Date(0),
			path: '/',
			httpOnly: false,
			secure: true,
			sameSite: 'lax',
		})
	}

	describe('Selection Cookie', () => {
		it('builds a browser-readable signed Workspace and Portfolio Selection Cookie', testBuildsSelectionCookie)
		it('verifies a valid Selection Cookie token', testVerifiesSelectionToken)
		it('rejects missing, malformed, and tampered Selection Cookie tokens', testRejectsMissingInvalidAndTamperedSelectionTokens)
		it('rejects expired Selection Cookie tokens', testRejectsExpiredSelectionTokens)
		it('builds delete metadata for clearing the Selection Cookie', testBuildsDeleteSelectionCookie)
	})
}
