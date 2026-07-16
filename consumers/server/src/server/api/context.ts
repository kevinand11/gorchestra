import type { ServerCache } from '../cache'
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
import type { PortfolioCoreSupervision } from '../core/portfolio-supervision'
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
	portfolioCores: PortfolioCoreSupervision
	now: ServerApiClock
}

export type CreateServerApiContextInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	security: ServerApiSecurity
	portfolioCores: PortfolioCoreSupervision
	now?: ServerApiClock
}

export function createServerApiContext(input: CreateServerApiContextInput): ServerApiContext {
	return {
		serverStorage: input.serverStorage,
		serverCache: input.serverCache,
		corePortfolioStorage: input.corePortfolioStorage,
		security: input.security,
		portfolioCores: input.portfolioCores,
		now: input.now ?? (() => new Date()),
	}
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest

	describe('Server API context', () => {
		it('uses the explicitly assembled Portfolio Core Supervision dependency', () => {
			const portfolioCores: PortfolioCoreSupervision = {
				start: vi.fn(() => Promise.resolve()),
				portfolioRegistered: vi.fn(),
				borrow: vi.fn(),
				close: vi.fn(() => Promise.resolve()),
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
				portfolioCores,
				now: () => new Date('2026-06-21T00:00:00.000Z'),
			})

			expect(context.portfolioCores).toBe(portfolioCores)
			expect(context.security.secretEncryptionKey).toEqual(Buffer.alloc(32, 1))
		})
	})
}
