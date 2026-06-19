import { normalizeEmailAddress } from './email-otp'
import { getServerStorage, openServerStorage, stopServerStorage, type ServerStorage } from '../storage/repo'
import { emailAuthenticationIdentitySchema, userSchema, type EmailAuthenticationIdentity, type ServerUser } from '../storage/schemas'

export type FindEmailAuthenticationIdentityInput = {
	email: string
	storage?: ServerStorage
}

export type CreateUserInput = {
	storage?: ServerStorage
	now?: Date
}

export type CreateEmailAuthenticationIdentityInput = {
	storage?: ServerStorage
	userId: string
	email: string
	now?: Date
}

export type GetOrCreateUserByVerifiedEmailInput = {
	storage?: ServerStorage
	email: string
	now?: Date
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
	return resolveServerStorage(input.storage)
		.repo.on(emailAuthenticationIdentitySchema)
		.one()
		.where((query) => query.eq(emailAuthenticationIdentitySchema.fields.email, email))
		.find()
}

export async function createUser(input: CreateUserInput = {}): Promise<ServerUser> {
	return resolveServerStorage(input.storage)
		.repo.on(userSchema)
		.one()
		.create({ createdAt: getTimestamp(input.now) })
}

export async function createEmailAuthenticationIdentity(
	input: CreateEmailAuthenticationIdentityInput,
): Promise<EmailAuthenticationIdentity> {
	const email = requireEmailAddress(input.email)
	const storage = resolveServerStorage(input.storage)
	await assertEmailAuthenticationIdentityAvailable(storage, email)
	return storage.repo
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
	const storage = resolveServerStorage(input.storage)
	return storage.repo.session(async () => getOrCreateUserByVerifiedEmailInStorage(storage, email, input.now))
}

async function getOrCreateUserByVerifiedEmailInStorage(
	storage: ServerStorage,
	email: string,
	now?: Date,
): Promise<GetOrCreateUserByVerifiedEmailResult> {
	const existingIdentity = await findEmailAuthenticationIdentityByEmail({ storage, email })
	if (existingIdentity) return getExistingVerifiedEmailUser(storage, existingIdentity)

	const user = await createUser({ storage, ...getOptionalNow(now) })
	const emailAuthenticationIdentity = await createEmailAuthenticationIdentity({
		storage,
		userId: user.id,
		email,
		...getOptionalNow(now),
	})
	return { user, emailAuthenticationIdentity, createdUser: true }
}

async function getExistingVerifiedEmailUser(
	storage: ServerStorage,
	emailAuthenticationIdentity: EmailAuthenticationIdentity,
): Promise<GetOrCreateUserByVerifiedEmailResult> {
	const user = await storage.repo.on(userSchema).one().id(emailAuthenticationIdentity.userId).required().find()
	return { user, emailAuthenticationIdentity, createdUser: false }
}

async function assertEmailAuthenticationIdentityAvailable(storage: ServerStorage, email: string): Promise<void> {
	const existingIdentity = await findEmailAuthenticationIdentityByEmail({ storage, email })
	if (existingIdentity) throw new Error('Email Authentication Identity already exists for email')
}

function resolveServerStorage(storage: ServerStorage | undefined): ServerStorage {
	return storage ?? getServerStorage()
}

function requireEmailAddress(email: string): string {
	const normalizedEmail = normalizeEmailAddress(email)
	if (!normalizedEmail.includes('@')) throw new Error('Verified email address is required')
	return normalizedEmail
}

function getOptionalNow(now: Date | undefined): Partial<Pick<CreateUserInput, 'now'>> {
	return now ? { now } : {}
}

function getTimestamp(now = new Date()): string {
	return now.toISOString()
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { mkdtemp, rm } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')
	const { join } = await import('node:path')

	let tempDataDirs: string[] = []
	const testNow = new Date('2026-06-19T12:00:00.000Z')

	afterEach(async () => {
		await stopServerStorage()
		await Promise.all(tempDataDirs.map((path) => rm(path, { recursive: true, force: true })))
		tempDataDirs = []
	})

	async function createTempDataDir(): Promise<string> {
		const dataDir = await mkdtemp(join(tmpdir(), 'gorchestra-server-identities-'))
		tempDataDirs.push(dataDir)
		return dataDir
	}

	function uniqueEmail(): string {
		return `person-${crypto.randomUUID()}@example.com`
	}

	async function withTempStorage<T>(run: (storage: ServerStorage) => Promise<T>): Promise<T> {
		const storage = await openServerStorage({ dataDir: await createTempDataDir() })
		try {
			return await run(storage)
		} finally {
			await storage.close()
		}
	}

	async function testVerifiedEmailCreatesUserAndIdentity(): Promise<void> {
		await withTempStorage(async (storage) => {
			const email = uniqueEmail()
			const result = await getOrCreateUserByVerifiedEmail({ storage, email, now: testNow })

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
		await withTempStorage(async (storage) => {
			const email = uniqueEmail()
			const first = await getOrCreateUserByVerifiedEmail({ storage, email, now: testNow })
			const second = await getOrCreateUserByVerifiedEmail({ storage, email, now: testNow })

			expect(second.createdUser).toBe(false)
			expect(second.user).toEqual(first.user)
			expect(second.emailAuthenticationIdentity).toEqual(first.emailAuthenticationIdentity)
		})
	}

	async function testEmailIdentityPersistsAcrossStorageOpen(): Promise<void> {
		const dataDir = await createTempDataDir()
		const email = uniqueEmail()
		const firstStorage = await openServerStorage({ dataDir })
		const first = await getOrCreateUserByVerifiedEmail({ storage: firstStorage, email, now: testNow })
		await firstStorage.close()

		const secondStorage = await openServerStorage({ dataDir })
		try {
			const second = await getOrCreateUserByVerifiedEmail({ storage: secondStorage, email, now: testNow })
			expect(second).toEqual({ ...first, createdUser: false })
		} finally {
			await secondStorage.close()
		}
	}

	async function testVerifiedEmailIsStoredNormalized(): Promise<void> {
		await withTempStorage(async (storage) => {
			const result = await getOrCreateUserByVerifiedEmail({ storage, email: '  Person+Ops@Example.COM  ', now: testNow })

			expect(result.emailAuthenticationIdentity.email).toBe('person+ops@example.com')
			expect(await findEmailAuthenticationIdentityByEmail({ storage, email: 'person+ops@example.com' })).toEqual(
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
