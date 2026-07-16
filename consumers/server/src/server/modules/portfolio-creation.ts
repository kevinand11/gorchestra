import { v } from 'valleyed'

import type { SecretEncryptionKey } from './secret-protection'
import { createPortfolioRegistryEntry } from './workspaces'
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
import {
	createCoreStorageNamespace,
	initializeCorePortfolioStorage,
	removeCorePortfolioStorage,
	type CorePortfolioStorageAdapterFactory,
} from '../core/storage'
import type { ServerStorage } from '../storage/repo'
import type { PortfolioRegistryEntry } from '../storage/schemas'

export type CreatePortfolioForWorkspaceInput = {
	serverStorage: ServerStorage
	workspaceId: string
	displayName: string
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	now: Date
	secretEncryptionKey: SecretEncryptionKey
	portfolioRegistered: (portfolioId: string) => void
	coreStorageNamespaceFactory?: () => string
	coreStorageAdapterFactory?: CorePortfolioStorageAdapterFactory
}

const displayNamePipe = v.string().pipe(v.asTrimmed(), v.min(1))

export async function createPortfolioForWorkspace(input: CreatePortfolioForWorkspaceInput): Promise<PortfolioRegistryEntry> {
	const displayName = requireDisplayName(input.displayName, 'Portfolio display name is required')
	const coreStorageNamespace = (input.coreStorageNamespaceFactory ?? createCoreStorageNamespace)()
	const coreStorageInput = {
		config: input.corePortfolioStorage,
		coreStorageNamespace,
		...(input.coreStorageAdapterFactory ? { adapterFactory: input.coreStorageAdapterFactory } : {}),
	}

	let portfolio: PortfolioRegistryEntry
	try {
		await initializeCorePortfolioStorage({ ...coreStorageInput, secretEncryptionKey: input.secretEncryptionKey })
		portfolio = await createPortfolioRegistryEntry({
			serverStorage: input.serverStorage,
			workspaceId: input.workspaceId,
			displayName,
			coreStorageNamespace,
			now: input.now,
		})
	} catch (error) {
		await removeCorePortfolioStorage({ config: input.corePortfolioStorage, coreStorageNamespace }).catch(() => {})
		throw error
	}

	try {
		input.portfolioRegistered(portfolio.id)
	} catch {
		// Durable Portfolio registration remains successful; reconciliation recovers a missed signal.
	}
	return portfolio
}

function requireDisplayName(displayName: string, message: string): string {
	const result = v.validate(displayNamePipe, displayName)
	if (!result.valid) throw new Error(message)
	return result.value
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it, vi } = import.meta.vitest
	const { existsSync } = await import('node:fs')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('./identities')
	const { createWorkspaceForUser } = await import('./workspace-creation')
	const { getCorePortfolioStorageDirectory, openCorePortfolioStorage } = await import('../core/storage')
	const { portfolioRegistryEntrySchema } = await import('../storage/schemas')

	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness('gorchestra-portfolio-creation-')
	const testNow = new Date('2026-07-07T10:00:00.000Z')
	const missingWorkspaceId = '01k00000000000000000000062'
	const secretEncryptionKey = Buffer.alloc(32, 1)

	afterEach(cleanupTempServerStorage)

	async function withPortfolioCreationStorage<T>(
		run: (input: { serverStorage: ServerStorage; dataDir: string }) => Promise<T>,
	): Promise<T> {
		const dataDir = await createTempServerDataDir()
		const serverStorage = await openServerStorage({ dataDir })
		try {
			return await run({ serverStorage, dataDir })
		} finally {
			await serverStorage.close()
		}
	}

	async function testCreatesPortfolioForWorkspace(): Promise<void> {
		await withPortfolioCreationStorage(async ({ serverStorage, dataDir }) => {
			const user = await createUser({ serverStorage, now: testNow })
			const { workspace } = await createWorkspaceForUser({
				serverStorage,
				userId: user.id,
				displayName: 'Delivery Ops',
				now: testNow,
			})
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/created-portfolio'
			const portfolioRegistered = vi.fn()

			const portfolio = await createPortfolioForWorkspace({
				serverStorage,
				workspaceId: workspace.id,
				displayName: '  Launch Portfolio  ',
				corePortfolioStorage,
				now: testNow,
				secretEncryptionKey,
				portfolioRegistered,
				coreStorageNamespaceFactory: () => coreStorageNamespace,
			})

			expect(portfolio).toMatchObject({
				workspaceId: workspace.id,
				displayName: 'Launch Portfolio',
				coreStorageNamespace,
				registeredAt: testNow.toISOString(),
			})
			expect(portfolioRegistered).toHaveBeenCalledWith(portfolio.id)
			const coreStorage = await openCorePortfolioStorage({ config: corePortfolioStorage, coreStorageNamespace })
			try {
				expect(await coreStorage.adapter.loadMigrations()).toEqual([
					expect.objectContaining({ id: '2026-06-16-0001-create-core-storage' }),
					expect.objectContaining({ id: '2026-07-13-0002-durable-dispatch' }),
				])
			} finally {
				await coreStorage.close()
			}
		})
	}

	async function testContainsRegistrationSignalFailure(): Promise<void> {
		await withPortfolioCreationStorage(async ({ serverStorage, dataDir }) => {
			const user = await createUser({ serverStorage, now: testNow })
			const { workspace } = await createWorkspaceForUser({
				serverStorage,
				userId: user.id,
				displayName: 'Delivery Ops',
				now: testNow,
			})
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/signal-failure'

			const portfolio = await createPortfolioForWorkspace({
				serverStorage,
				workspaceId: workspace.id,
				displayName: 'Launch Portfolio',
				corePortfolioStorage,
				now: testNow,
				secretEncryptionKey,
				portfolioRegistered: () => {
					throw new Error('signal failed')
				},
				coreStorageNamespaceFactory: () => coreStorageNamespace,
			})

			expect(portfolio.coreStorageNamespace).toBe(coreStorageNamespace)
			expect(await serverStorage.repo.on(portfolioRegistryEntrySchema).one().id(portfolio.id).find()).toEqual(portfolio)
			expect(existsSync(getCorePortfolioStorageDirectory(corePortfolioStorage, coreStorageNamespace))).toBe(true)
		})
	}

	async function testRejectsEmptyDisplayNameBeforeCreatingCoreStorage(): Promise<void> {
		await withPortfolioCreationStorage(async ({ serverStorage, dataDir }) => {
			const user = await createUser({ serverStorage, now: testNow })
			const { workspace } = await createWorkspaceForUser({
				serverStorage,
				userId: user.id,
				displayName: 'Delivery Ops',
				now: testNow,
			})
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/empty-name'

			await expect(
				createPortfolioForWorkspace({
					serverStorage,
					workspaceId: workspace.id,
					displayName: '  ',
					corePortfolioStorage,
					now: testNow,
					secretEncryptionKey,
					portfolioRegistered: () => {},
					coreStorageNamespaceFactory: () => coreStorageNamespace,
				}),
			).rejects.toThrow('Portfolio display name is required')
			expect(existsSync(getCorePortfolioStorageDirectory(corePortfolioStorage, coreStorageNamespace))).toBe(false)
		})
	}

	async function testCleansCoreStorageWhenRegistryCreationFails(): Promise<void> {
		await withPortfolioCreationStorage(async ({ serverStorage, dataDir }) => {
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/missing-workspace'

			await expect(
				createPortfolioForWorkspace({
					serverStorage,
					workspaceId: missingWorkspaceId,
					displayName: 'Launch Portfolio',
					corePortfolioStorage,
					now: testNow,
					secretEncryptionKey,
					portfolioRegistered: () => {},
					coreStorageNamespaceFactory: () => coreStorageNamespace,
				}),
			).rejects.toThrow()

			expect(existsSync(getCorePortfolioStorageDirectory(corePortfolioStorage, coreStorageNamespace))).toBe(false)
			expect(await serverStorage.repo.on(portfolioRegistryEntrySchema).all().find()).toEqual([])
		})
	}

	describe('Portfolio Creation module', () => {
		it('creates a Portfolio Registry Entry backed by initialized Core storage', testCreatesPortfolioForWorkspace)
		it('keeps durable Portfolio Creation successful when the runtime signal fails', testContainsRegistrationSignalFailure)
		it('rejects an empty display name before creating Core storage', testRejectsEmptyDisplayNameBeforeCreatingCoreStorage)
		it('cleans up Core storage when Portfolio registry creation fails', testCleansCoreStorageWhenRegistryCreationFails)
	})
}
