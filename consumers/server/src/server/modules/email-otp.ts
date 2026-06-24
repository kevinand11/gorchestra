import { Random } from 'equipped/utilities'

import type { ServerCache } from '../cache'

const emailOtpChallengeTtlMs = 10 * 60 * 1000
const emailOtpChallengeTtlSeconds = emailOtpChallengeTtlMs / 1000
const maxFailedAttempts = 5
const emailOtpCodePattern = /^\d{6}$/

type EmailOtpChallenge = {
	normalizedEmail: string
	code: string
	failedAttempts: number
	issuedAt: number
	expiresAt: number
}

type ActiveEmailOtpChallengeLookup = { found: true; challenge: EmailOtpChallenge } | { found: false; result: VerifyEmailOtpChallengeResult }

export type EmailOtpMailMessage = {
	to: string
	code: string
	expiresAt: Date
}

export type EmailOtpMailService = {
	sendEmailOtp: (message: EmailOtpMailMessage) => Promise<void>
}

export type CreateEmailOtpChallengeInput = {
	serverCache: ServerCache
	email: string
	mailService?: EmailOtpMailService
	now: Date
	generateCode?: () => string
}

export type CreateEmailOtpChallengeResult = {
	requested: true
}

export type VerifyEmailOtpChallengeInput = {
	serverCache: ServerCache
	email: string
	code: string
	now: Date
}

export type VerifyEmailOtpChallengeResult =
	| { verified: true; normalizedEmail: string }
	| { verified: false; reason: 'not-found' | 'expired' | 'invalid-code' | 'too-many-failed-attempts' }

export const consoleMailService: EmailOtpMailService = {
	sendEmailOtp(message) {
		process.stdout.write(`[gorchestra] Email OTP for ${message.to}: ${message.code} (expires at ${message.expiresAt.toISOString()})\n`)
		return Promise.resolve()
	},
}

export function normalizeEmailAddress(email: string): string {
	return email.trim().toLowerCase()
}

export async function createEmailOtpChallenge(input: CreateEmailOtpChallengeInput): Promise<CreateEmailOtpChallengeResult> {
	const challenge = buildEmailOtpChallenge(input)
	await storeEmailOtpChallenge(input.serverCache, challenge)
	await sendEmailOtpChallenge(input.mailService ?? consoleMailService, challenge)
	return { requested: true }
}

export async function verifyEmailOtpChallenge(input: VerifyEmailOtpChallengeInput): Promise<VerifyEmailOtpChallengeResult> {
	const context = getVerifyEmailOtpContext(input)
	const lookup = await findActiveEmailOtpChallenge(input.serverCache, context.cacheKey, context.now)
	if (!lookup.found) return lookup.result
	return verifyActiveEmailOtpChallenge(input.serverCache, context, lookup.challenge)
}

function buildEmailOtpChallenge(input: CreateEmailOtpChallengeInput): EmailOtpChallenge {
	const normalizedEmail = requireNormalizedEmailAddress(input.email)
	const code = getEmailOtpCode(input.generateCode)
	return {
		normalizedEmail,
		code,
		failedAttempts: 0,
		issuedAt: input.now.getTime(),
		expiresAt: input.now.getTime() + emailOtpChallengeTtlMs,
	}
}

function getEmailOtpCode(generateCode?: () => string): string {
	const code = generateCode?.() ?? generateEmailOtpCode()
	if (!emailOtpCodePattern.test(code)) throw new Error('Email OTP code must be a six-digit numeric string')
	return code
}

async function storeEmailOtpChallenge(serverCache: ServerCache, challenge: EmailOtpChallenge): Promise<void> {
	await serverCache.setJson(getEmailOtpChallengeCacheKey(challenge.normalizedEmail), challenge, emailOtpChallengeTtlSeconds)
}

async function sendEmailOtpChallenge(mailService: EmailOtpMailService, challenge: EmailOtpChallenge): Promise<void> {
	await mailService.sendEmailOtp({
		to: challenge.normalizedEmail,
		code: challenge.code,
		expiresAt: new Date(challenge.expiresAt),
	})
}

function getVerifyEmailOtpContext(input: VerifyEmailOtpChallengeInput) {
	const normalizedEmail = requireNormalizedEmailAddress(input.email)
	return {
		code: input.code.trim(),
		now: input.now,
		cacheKey: getEmailOtpChallengeCacheKey(normalizedEmail),
	}
}

async function findActiveEmailOtpChallenge(serverCache: ServerCache, cacheKey: string, now: Date): Promise<ActiveEmailOtpChallengeLookup> {
	const challenge = await serverCache.getJson<EmailOtpChallenge>(cacheKey)
	if (!challenge) return { found: false, result: { verified: false, reason: 'not-found' } }
	if (challenge.expiresAt > now.getTime()) return { found: true, challenge }
	await serverCache.deleteValue(cacheKey)
	return { found: false, result: { verified: false, reason: 'expired' } }
}

async function verifyActiveEmailOtpChallenge(
	serverCache: ServerCache,
	context: ReturnType<typeof getVerifyEmailOtpContext>,
	challenge: EmailOtpChallenge,
): Promise<VerifyEmailOtpChallengeResult> {
	if (context.code === challenge.code) return consumeVerifiedEmailOtpChallenge(serverCache, context.cacheKey, challenge)
	return recordFailedEmailOtpAttempt(serverCache, context.cacheKey, challenge, context.now)
}

async function consumeVerifiedEmailOtpChallenge(
	serverCache: ServerCache,
	cacheKey: string,
	challenge: EmailOtpChallenge,
): Promise<VerifyEmailOtpChallengeResult> {
	await serverCache.deleteValue(cacheKey)
	return { verified: true, normalizedEmail: challenge.normalizedEmail }
}

async function recordFailedEmailOtpAttempt(
	serverCache: ServerCache,
	cacheKey: string,
	challenge: EmailOtpChallenge,
	now: Date,
): Promise<VerifyEmailOtpChallengeResult> {
	const failedAttempts = challenge.failedAttempts + 1
	if (failedAttempts >= maxFailedAttempts) return invalidateEmailOtpChallenge(serverCache, cacheKey)
	await serverCache.setJson(cacheKey, { ...challenge, failedAttempts }, getRemainingTtlSeconds(challenge.expiresAt, now))
	return { verified: false, reason: 'invalid-code' }
}

async function invalidateEmailOtpChallenge(serverCache: ServerCache, cacheKey: string): Promise<VerifyEmailOtpChallengeResult> {
	await serverCache.deleteValue(cacheKey)
	return { verified: false, reason: 'too-many-failed-attempts' }
}

function requireNormalizedEmailAddress(email: string): string {
	const normalizedEmail = normalizeEmailAddress(email)
	if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('Email address is required')
	return normalizedEmail
}

function getEmailOtpChallengeCacheKey(normalizedEmail: string): string {
	return `email-otp-challenge:${encodeURIComponent(normalizedEmail)}`
}

function generateEmailOtpCode(): string {
	return Random.number(1e5, 1e6).toString()
}

function getRemainingTtlSeconds(expiresAt: number, now: Date): number {
	return Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')

	const testNow = new Date('2026-06-19T00:00:00.000Z')

	function uniqueEmail(): string {
		return `person-${crypto.randomUUID()}@example.com`
	}

	function captureMailService(messages: EmailOtpMailMessage[]): EmailOtpMailService {
		return {
			sendEmailOtp(message) {
				messages.push(message)
				return Promise.resolve()
			},
		}
	}

	function testNormalizeEmailAddress(): void {
		expect(normalizeEmailAddress('  Person+Ops@Example.COM  ')).toBe('person+ops@example.com')
	}

	async function testLatestOnlyEmailOtpChallenge(): Promise<void> {
		const serverCache = createTestServerCache()
		const email = uniqueEmail()
		const messages: EmailOtpMailMessage[] = []
		const mailService = captureMailService(messages)

		await createEmailOtpChallenge({
			serverCache,
			email: `  ${email.toUpperCase()}  `,
			generateCode: () => '111111',
			mailService,
			now: testNow,
		})
		await createEmailOtpChallenge({ serverCache, email, generateCode: () => '222222', mailService, now: testNow })

		expect(messages.map(({ code, to }) => ({ code, to }))).toEqual([
			{ code: '111111', to: email },
			{ code: '222222', to: email },
		])
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '111111', now: testNow })).toEqual({
			verified: false,
			reason: 'invalid-code',
		})
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '222222', now: testNow })).toEqual({
			verified: true,
			normalizedEmail: email,
		})
	}

	async function testSingleUseEmailOtpChallenge(): Promise<void> {
		const serverCache = createTestServerCache()
		const email = uniqueEmail()
		await createEmailOtpChallenge({
			serverCache,
			email,
			generateCode: () => '333333',
			mailService: captureMailService([]),
			now: testNow,
		})

		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '333333', now: testNow })).toEqual({
			verified: true,
			normalizedEmail: email,
		})
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '333333', now: testNow })).toEqual({
			verified: false,
			reason: 'not-found',
		})
	}

	async function testExpiredEmailOtpChallenge(): Promise<void> {
		const serverCache = createTestServerCache()
		const email = uniqueEmail()
		const afterExpiry = new Date(testNow.getTime() + emailOtpChallengeTtlMs + 1)
		await createEmailOtpChallenge({
			serverCache,
			email,
			generateCode: () => '444444',
			mailService: captureMailService([]),
			now: testNow,
		})

		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '444444', now: afterExpiry })).toEqual({
			verified: false,
			reason: 'expired',
		})
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '444444', now: afterExpiry })).toEqual({
			verified: false,
			reason: 'not-found',
		})
	}

	async function testFailedAttemptsEmailOtpChallenge(): Promise<void> {
		const serverCache = createTestServerCache()
		const email = uniqueEmail()
		await createEmailOtpChallenge({
			serverCache,
			email,
			generateCode: () => '555555',
			mailService: captureMailService([]),
			now: testNow,
		})

		for (const _attempt of [1, 2, 3, 4]) {
			expect(await verifyEmailOtpChallenge({ serverCache, email, code: '000000', now: testNow })).toEqual({
				verified: false,
				reason: 'invalid-code',
			})
		}
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '000000', now: testNow })).toEqual({
			verified: false,
			reason: 'too-many-failed-attempts',
		})
		expect(await verifyEmailOtpChallenge({ serverCache, email, code: '555555', now: testNow })).toEqual({
			verified: false,
			reason: 'not-found',
		})
	}

	describe('Email OTP Sign-in', () => {
		it('normalizes email addresses by trimming and lowercasing the full address', testNormalizeEmailAddress)
		it('creates a latest-only Email OTP Challenge and sends the latest code to the normalized email', testLatestOnlyEmailOtpChallenge)
		it('makes a verified Email OTP Challenge single-use', testSingleUseEmailOtpChallenge)
		it('expires Email OTP Challenges after ten minutes', testExpiredEmailOtpChallenge)
		it('invalidates an Email OTP Challenge after five failed attempts', testFailedAttemptsEmailOtpChallenge)
	})
}
