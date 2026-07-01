import type { ServerCache } from '../cache'
import type { ServerEnv } from '../env'
import { createServerDispatcher, type ServerDispatcher } from '../modules/dispatcher'
import type { SecretEncryptionKey } from '../modules/secret-protection'
import type { ServerStorage } from '../storage/repo'

export type ServerApiClock = () => Date

export type ServerApiContext = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	dataDir: string
	sessionSigningKey: string
	selectionSigningKey: string
	secretEncryptionKey: SecretEncryptionKey
	dispatcher: ServerDispatcher
	now: ServerApiClock
}

export type CreateServerApiContextInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	env: ServerEnv
	dispatcher?: ServerDispatcher
	now?: ServerApiClock
}

export function createServerApiContext(input: CreateServerApiContextInput): ServerApiContext {
	const dispatcher =
		input.dispatcher ??
		createServerDispatcher({
			dataDir: input.env.GORCHESTRA_DATA_DIR,
			secretEncryptionKey: input.env.GORCHESTRA_SECRET_ENCRYPTION_KEY,
		})

	return {
		serverStorage: input.serverStorage,
		serverCache: input.serverCache,
		dataDir: input.env.GORCHESTRA_DATA_DIR,
		sessionSigningKey: input.env.GORCHESTRA_SESSION_JWT_SIGNING_KEY,
		selectionSigningKey: input.env.GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY,
		secretEncryptionKey: input.env.GORCHESTRA_SECRET_ENCRYPTION_KEY,
		dispatcher,
		now: input.now ?? (() => new Date()),
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server API context', () => {
		it('uses an explicit Agent Run dispatcher override', () => {
			const dispatcher: ServerDispatcher = {
				preflight: () => Promise.resolve({ ok: true }),
				requestDispatch: () => Promise.resolve(),
			}

			const context = createServerApiContext({
				serverStorage: {} as ServerStorage,
				serverCache: {} as ServerCache,
				env: {
					GORCHESTRA_PORT: 0,
					GORCHESTRA_DATA_DIR: '/tmp/gorchestra-test',
					GORCHESTRA_SESSION_JWT_SIGNING_KEY: 'session-key',
					GORCHESTRA_SELECTION_COOKIE_SIGNING_KEY: 'selection-key',
					GORCHESTRA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1),
				},
				dispatcher,
				now: () => new Date('2026-06-21T00:00:00.000Z'),
			})

			expect(context.dispatcher).toBe(dispatcher)
			expect(context.secretEncryptionKey).toEqual(Buffer.alloc(32, 1))
		})
	})
}
