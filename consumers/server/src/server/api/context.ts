import type { ServerCache } from '../cache'
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
import { createServerDispatcher, type ServerDispatcher } from '../modules/dispatcher'
import type { SecretEncryptionKey } from '../modules/secret-protection'
import type { ServerStorage } from '../storage/repo'

export type ServerApiClock = () => Date

export type ServerApiSecurity = {
	sessionSigningKey: string
	selectionSigningKey: string
	secretEncryptionKey: SecretEncryptionKey
}

export type ServerApiContext = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	security: ServerApiSecurity
	dispatcher: ServerDispatcher
	now: ServerApiClock
}

export type CreateServerApiContextInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	security: ServerApiSecurity
	dispatcher?: ServerDispatcher
	now?: ServerApiClock
}

export function createServerApiContext(input: CreateServerApiContextInput): ServerApiContext {
	const dispatcher =
		input.dispatcher ??
		createServerDispatcher({
			corePortfolioStorage: input.corePortfolioStorage,
			secretEncryptionKey: input.security.secretEncryptionKey,
		})

	return {
		serverStorage: input.serverStorage,
		serverCache: input.serverCache,
		corePortfolioStorage: input.corePortfolioStorage,
		security: input.security,
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
				request: () => Promise.resolve('dispatch-marker'),
				ready: () => {},
			}

			const context = createServerApiContext({
				serverStorage: {} as ServerStorage,
				serverCache: {} as ServerCache,
				corePortfolioStorage: { type: 'json', dataDir: '/tmp/gorchestra-test' },
				security: {
					sessionSigningKey: 'session-key',
					selectionSigningKey: 'selection-key',
					secretEncryptionKey: Buffer.alloc(32, 1),
				},
				dispatcher,
				now: () => new Date('2026-06-21T00:00:00.000Z'),
			})

			expect(context.dispatcher).toBe(dispatcher)
			expect(context.security.secretEncryptionKey).toEqual(Buffer.alloc(32, 1))
		})
	})
}
