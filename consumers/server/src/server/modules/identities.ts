import { normalizeEmailAddress } from './email-otp'
import type { ServerStorage } from '../storage/repo'
import { emailAuthenticationIdentitySchema, userSchema, type EmailAuthenticationIdentity, type ServerUser } from '../storage/schemas'

export type FindEmailAuthenticationIdentityInput = {
	serverStorage: ServerStorage
	email: string
}

export type CreateUserInput = {
	serverStorage: ServerStorage
	now: Date
}

export type CreateEmailAuthenticationIdentityInput = {
	serverStorage: ServerStorage
	userId: string
	email: string
	now: Date
}

export type GetOrCreateUserByVerifiedEmailInput = {
	serverStorage: ServerStorage
	email: string
	now: Date
}

export type GetOrCreateUserByVerifiedEmailResult = {
	user: ServerUser
	emailAuthenticationIdentity: EmailAuthenticationIdentity
	createdUser: boolean
}

export async function findEmailAuthenticationIdentityByEmail(
	input: FindEmailAuthenticationIdentityInput,
): Promise<EmailAuthenticationIdentity | null> {
	const email = requireEmailAddress(input.email)
	return input.serverStorage.repo
		.on(emailAuthenticationIdentitySchema)
		.one()
		.where((query) => query.eq(emailAuthenticationIdentitySchema.fields.email, email))
		.find()
}

export async function createUser(input: CreateUserInput): Promise<ServerUser> {
	return input.serverStorage.repo
		.on(userSchema)
		.one()
		.create({ createdAt: getTimestamp(input.now) })
}

export async function createEmailAuthenticationIdentity(
	input: CreateEmailAuthenticationIdentityInput,
): Promise<EmailAuthenticationIdentity> {
	const email = requireEmailAddress(input.email)
	await assertEmailAuthenticationIdentityAvailable(input.serverStorage, email)
	return input.serverStorage.repo
		.on(emailAuthenticationIdentitySchema)
		.one()
		.create({
			userId: input.userId,
			email,
			createdAt: getTimestamp(input.now),
		})
}

export async function getOrCreateUserByVerifiedEmail(
	input: GetOrCreateUserByVerifiedEmailInput,
): Promise<GetOrCreateUserByVerifiedEmailResult> {
	const email = requireEmailAddress(input.email)
	return input.serverStorage.repo.session(async () => getOrCreateUserByVerifiedEmailInStorage(input.serverStorage, email, input.now))
}

async function getOrCreateUserByVerifiedEmailInStorage(
	serverStorage: ServerStorage,
	email: string,
	now: Date,
): Promise<GetOrCreateUserByVerifiedEmailResult> {
	const existingIdentity = await findEmailAuthenticationIdentityByEmail({ serverStorage, email })
	if (existingIdentity) return getExistingVerifiedEmailUser(serverStorage, existingIdentity)

	const user = await createUser({ serverStorage, now })
	const emailAuthenticationIdentity = await createEmailAuthenticationIdentity({
		serverStorage,
		userId: user.id,
		email,
		now,
	})
	return { user, emailAuthenticationIdentity, createdUser: true }
}

async function getExistingVerifiedEmailUser(
	serverStorage: ServerStorage,
	emailAuthenticationIdentity: EmailAuthenticationIdentity,
): Promise<GetOrCreateUserByVerifiedEmailResult> {
	const user = await serverStorage.repo.on(userSchema).one().id(emailAuthenticationIdentity.userId).required().find()
	return { user, emailAuthenticationIdentity, createdUser: false }
}

async function assertEmailAuthenticationIdentityAvailable(serverStorage: ServerStorage, email: string): Promise<void> {
	const existingIdentity = await findEmailAuthenticationIdentityByEmail({ serverStorage, email })
	if (existingIdentity) throw new Error('Email Authentication Identity already exists for email')
}

function requireEmailAddress(email: string): string {
	const normalizedEmail = normalizeEmailAddress(email)
	if (!normalizedEmail.includes('@')) throw new Error('Verified email address is required')
	return normalizedEmail
}

function getTimestamp(now: Date): string {
	return now.toISOString()
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { openServerStorage } = await import('../storage/repo')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')

	const { cleanupTempServerStorage, createTempServerDataDir, withTempServerStorage } =
		createTempServerStorageTestHarness('gorchestra-server-identities-')
	const testNow = new Date('2026-06-19T12:00:00.000Z')

	afterEach(cleanupTempServerStorage)

	function uniqueEmail(): string {
		return `person-${crypto.randomUUID()}@example.com`
	}

	async function testVerifiedEmailCreatesUserAndIdentity(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const email = uniqueEmail()
			const result = await getOrCreateUserByVerifiedEmail({ serverStorage, email, now: testNow })

			expect(result.createdUser).toBe(true)
			expect(result.user.createdAt).toBe(testNow.toISOString())
			expect(result.emailAuthenticationIdentity).toMatchObject({
				userId: result.user.id,
				email,
				createdAt: testNow.toISOString(),
			})
		})
	}

	async function testVerifiedEmailReusesExistingIdentityUser(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const email = uniqueEmail()
			const first = await getOrCreateUserByVerifiedEmail({ serverStorage, email, now: testNow })
			const second = await getOrCreateUserByVerifiedEmail({ serverStorage, email, now: testNow })

			expect(second.createdUser).toBe(false)
			expect(second.user).toEqual(first.user)
			expect(second.emailAuthenticationIdentity).toEqual(first.emailAuthenticationIdentity)
		})
	}

	async function testEmailIdentityPersistsAcrossStorageOpen(): Promise<void> {
		const dataDir = await createTempServerDataDir()
		const email = uniqueEmail()
		const firstStorage = await openServerStorage({ dataDir })
		const first = await getOrCreateUserByVerifiedEmail({ serverStorage: firstStorage, email, now: testNow })
		await firstStorage.close()

		const secondStorage = await openServerStorage({ dataDir })
		try {
			const second = await getOrCreateUserByVerifiedEmail({ serverStorage: secondStorage, email, now: testNow })
			expect(second).toEqual({ ...first, createdUser: false })
		} finally {
			await secondStorage.close()
		}
	}

	async function testVerifiedEmailIsStoredNormalized(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const result = await getOrCreateUserByVerifiedEmail({ serverStorage, email: '  Person+Ops@Example.COM  ', now: testNow })

			expect(result.emailAuthenticationIdentity.email).toBe('person+ops@example.com')
			expect(await findEmailAuthenticationIdentityByEmail({ serverStorage, email: 'person+ops@example.com' })).toEqual(
				result.emailAuthenticationIdentity,
			)
		})
	}

	describe('Server identity storage', () => {
		it('creates a User and Email Authentication Identity for a verified email address', testVerifiedEmailCreatesUserAndIdentity)
		it('returns the existing User for an existing Email Authentication Identity', testVerifiedEmailReusesExistingIdentityUser)
		it('persists Email Authentication Identity links in Server storage', testEmailIdentityPersistsAcrossStorageOpen)
		it('stores verified email addresses in normalized form behind the email field', testVerifiedEmailIsStoredNormalized)
	})
}
