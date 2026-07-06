import { createEmailOtpChallenge, type EmailOtpMailMessage, verifyEmailOtpChallenge, type VerifyEmailOtpChallengeResult } from './email-otp'
import { findEmailAuthenticationIdentityByEmail, getOrCreateUserByVerifiedEmail } from './identities'
import { createSession, type CreateSessionInput, type CreateSessionResult, verifySessionToken } from './sessions'
import type { ServerCache } from '../cache'
import type { ServerStorage } from '../storage/repo'
import type { EmailAuthenticationIdentity, ServerUser } from '../storage/schemas'

type EmailOtpSignInFailureReason = Extract<VerifyEmailOtpChallengeResult, { verified: false }>['reason']

export type VerifyEmailOtpSignInInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	email: string
	code: string
	now: Date
	signingKey: string
	generateSessionId?: () => string
}

export type VerifyEmailOtpSignInResult =
	| {
			signedIn: true
			user: ServerUser
			emailAuthenticationIdentity: EmailAuthenticationIdentity
			createdUser: boolean
			token: CreateSessionResult['token']
			session: CreateSessionResult['session']
			cookie: CreateSessionResult['cookie']
	  }
	| { signedIn: false; reason: EmailOtpSignInFailureReason }

export async function verifyEmailOtpSignIn(input: VerifyEmailOtpSignInInput): Promise<VerifyEmailOtpSignInResult> {
	const verifiedEmail = await verifyEmailOtpChallenge({
		serverCache: input.serverCache,
		email: input.email,
		code: input.code,
		now: input.now,
	})
	if (!verifiedEmail.verified) return { signedIn: false, reason: verifiedEmail.reason }

	const identity = await getOrCreateUserByVerifiedEmail({
		serverStorage: input.serverStorage,
		email: verifiedEmail.normalizedEmail,
		now: input.now,
	})
	const session = await createSession(buildCreateSessionInput(input, identity.user.id, verifiedEmail.normalizedEmail))
	return { signedIn: true, ...identity, ...session }
}

function buildCreateSessionInput(input: VerifyEmailOtpSignInInput, userId: string, email: string): CreateSessionInput {
	return {
		serverCache: input.serverCache,
		userId,
		email,
		now: input.now,
		signingKey: input.signingKey,
		...getOptionalGenerateSessionId(input.generateSessionId),
	}
}

function getOptionalGenerateSessionId(
	generateSessionId: (() => string) | undefined,
): { generateSessionId: () => string } | Record<string, never> {
	return generateSessionId ? { generateSessionId } : {}
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')

	const { cleanupTempServerStorage, withTempServerStorage } = createTempServerStorageTestHarness('gorchestra-server-email-otp-sign-in-')
	const signingKey = 'test-email-otp-sign-in-session-key'
	const testNow = new Date('2026-06-19T12:00:00.000Z')
	const firstSessionId = '01k00000000000000000000021'
	const secondSessionId = '01k00000000000000000000022'

	afterEach(cleanupTempServerStorage)

	function uniqueEmail(): string {
		return `person-${crypto.randomUUID()}@example.com`
	}

	function captureMailService(messages: EmailOtpMailMessage[]) {
		return {
			sendEmailOtp(message: EmailOtpMailMessage) {
				messages.push(message)
				return Promise.resolve()
			},
		}
	}

	async function createOtp(serverCache: ServerCache, email: string, code: string, now = testNow): Promise<void> {
		await createEmailOtpChallenge({ serverCache, email, generateCode: () => code, mailService: captureMailService([]), now })
	}

	async function testVerifiedEmailOtpCreatesUserIdentityAndSession(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const serverCache = createTestServerCache()
			const email = uniqueEmail()
			await createOtp(serverCache, `  ${email.toUpperCase()}  `, '123456')

			const result = await verifyEmailOtpSignIn({
				serverStorage,
				serverCache,
				email,
				code: '123456',
				now: testNow,
				signingKey,
				generateSessionId: () => firstSessionId,
			})

			expect(result.signedIn).toBe(true)
			if (!result.signedIn) return
			expect(result.createdUser).toBe(true)
			expect(result.emailAuthenticationIdentity).toMatchObject({ userId: result.user.id, email })
			expect(result.session).toMatchObject({ userId: result.user.id, email, sessionId: firstSessionId })
			expect(result.cookie).toMatchObject({
				name: 'gorchestra_session',
				value: result.token,
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
			})
			expect(await verifySessionToken({ serverCache, token: result.token, now: testNow, signingKey })).toEqual({
				authenticated: true,
				session: result.session,
				refreshRecommended: false,
			})
		})
	}

	async function testInvalidEmailOtpDoesNotCreateIdentity(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const serverCache = createTestServerCache()
			const email = uniqueEmail()
			await createOtp(serverCache, email, '123456')

			expect(await verifyEmailOtpSignIn({ serverStorage, serverCache, email, code: '000000', now: testNow, signingKey })).toEqual({
				signedIn: false,
				reason: 'invalid-code',
			})
			expect(await findEmailAuthenticationIdentityByEmail({ serverStorage, email })).toBeNull()
		})
	}

	async function testEmailOtpSignInIsSingleUse(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const serverCache = createTestServerCache()
			const email = uniqueEmail()
			await createOtp(serverCache, email, '222222')

			const first = await verifyEmailOtpSignIn({ serverStorage, serverCache, email, code: '222222', now: testNow, signingKey })
			expect(first.signedIn).toBe(true)
			expect(await verifyEmailOtpSignIn({ serverStorage, serverCache, email, code: '222222', now: testNow, signingKey })).toEqual({
				signedIn: false,
				reason: 'not-found',
			})
		})
	}

	async function testExistingEmailIdentityUserGetsNewCurrentSession(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const serverCache = createTestServerCache()
			const email = uniqueEmail()
			const secondSignInTime = new Date(testNow.getTime() + 1000)
			await createOtp(serverCache, email, '333333')
			const first = await verifyEmailOtpSignIn({
				serverStorage,
				serverCache,
				email,
				code: '333333',
				now: testNow,
				signingKey,
				generateSessionId: () => firstSessionId,
			})
			if (!first.signedIn) throw new Error('expected first Email OTP Sign-in to succeed')

			await createOtp(serverCache, email, '444444', secondSignInTime)
			const second = await verifyEmailOtpSignIn({
				serverStorage,
				serverCache,
				email,
				code: '444444',
				now: secondSignInTime,
				signingKey,
				generateSessionId: () => secondSessionId,
			})

			expect(second.signedIn).toBe(true)
			if (!second.signedIn) return
			expect(second.createdUser).toBe(false)
			expect(second.user).toEqual(first.user)
			expect(second.emailAuthenticationIdentity).toEqual(first.emailAuthenticationIdentity)
			expect(second.session).toMatchObject({ userId: first.user.id, email, sessionId: secondSessionId })
			expect(await verifySessionToken({ serverCache, token: first.token, now: secondSignInTime, signingKey })).toEqual({
				authenticated: false,
				reason: 'not-current',
			})
			expect(await verifySessionToken({ serverCache, token: second.token, now: secondSignInTime, signingKey })).toEqual({
				authenticated: true,
				session: second.session,
				refreshRecommended: false,
			})
		})
	}

	describe('Email OTP Sign-in', () => {
		it(
			'creates a User, Email Authentication Identity, and Session after a verified Email OTP Challenge',
			testVerifiedEmailOtpCreatesUserIdentityAndSession,
		)
		it('does not create an Email Authentication Identity when the Email OTP Challenge fails', testInvalidEmailOtpDoesNotCreateIdentity)
		it('makes a successful Email OTP Sign-in single-use', testEmailOtpSignInIsSingleUse)
		it(
			'reuses an existing Email Authentication Identity User and replaces the current Session',
			testExistingEmailIdentityUserGetsNewCurrentSession,
		)
	})
}
