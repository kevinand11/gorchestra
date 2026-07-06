import { v } from 'valleyed'

import type { SecretEncryptionKey } from './secret-protection'
import { assignWorkspaceOwnerRole, createPortfolioRegistryEntry, createWorkspace, createWorkspaceMember } from './workspaces'
import type { ServerConsumerCorePortfolioStorageConfig } from '../config'
import {
	createCoreStorageNamespace,
	initializeCorePortfolioStorage,
	removeCorePortfolioStorage,
	type CorePortfolioStorageAdapterFactory,
} from '../core/storage'
import type { ServerStorage } from '../storage/repo'
import type { PortfolioRegistryEntry, Workspace, WorkspaceMember, WorkspaceOwnerRole } from '../storage/schemas'

export type ProvisionWorkspaceWithDefaultPortfolioInput = {
	serverStorage: ServerStorage
	userId: string
	workspaceDisplayName: string
	portfolioDisplayName: string
	corePortfolioStorage: ServerConsumerCorePortfolioStorageConfig
	now: Date
	secretEncryptionKey: SecretEncryptionKey
	coreStorageNamespaceFactory?: () => string
	coreStorageAdapterFactory?: CorePortfolioStorageAdapterFactory
}

export type ProvisionWorkspaceWithDefaultPortfolioResult = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	workspaceOwnerRole: WorkspaceOwnerRole
	portfolio: PortfolioRegistryEntry
}

const displayNamePipe = v.string().pipe(v.asTrimmed(), v.min(1))

export async function provisionWorkspaceWithDefaultPortfolio(
	input: ProvisionWorkspaceWithDefaultPortfolioInput,
): Promise<ProvisionWorkspaceWithDefaultPortfolioResult> {
	const workspaceDisplayName = requireDisplayName(input.workspaceDisplayName, 'Workspace display name is required')
	const portfolioDisplayName = requireDisplayName(input.portfolioDisplayName, 'Portfolio display name is required')
	const coreStorageNamespace = (input.coreStorageNamespaceFactory ?? createCoreStorageNamespace)()

	const coreStorageInput = {
		config: input.corePortfolioStorage,
		coreStorageNamespace,
		...(input.coreStorageAdapterFactory ? { adapterFactory: input.coreStorageAdapterFactory } : {}),
	}

	try {
		await initializeCorePortfolioStorage({ ...coreStorageInput, secretEncryptionKey: input.secretEncryptionKey })
		return await input.serverStorage.repo.session(async () => {
			const workspace = await createWorkspace({
				serverStorage: input.serverStorage,
				displayName: workspaceDisplayName,
				now: input.now,
			})
			const workspaceMember = await createWorkspaceMember({
				serverStorage: input.serverStorage,
				workspaceId: workspace.id,
				userId: input.userId,
				now: input.now,
			})
			const workspaceOwnerRole = await assignWorkspaceOwnerRole({
				serverStorage: input.serverStorage,
				workspaceMemberId: workspaceMember.id,
				now: input.now,
			})
			const portfolio = await createPortfolioRegistryEntry({
				serverStorage: input.serverStorage,
				workspaceId: workspace.id,
				displayName: portfolioDisplayName,
				coreStorageNamespace,
				now: input.now,
			})

			return { workspace, workspaceMember, workspaceOwnerRole, portfolio }
		})
	} catch (error) {
		await removeCorePortfolioStorage({ config: input.corePortfolioStorage, coreStorageNamespace }).catch(() => {})
		throw error
	}
}

function requireDisplayName(displayName: string, message: string): string {
	const result = v.validate(displayNamePipe, displayName)
	if (!result.valid) throw new Error(message)
	return result.value
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { existsSync } = await import('node:fs')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('./identities')
	const { listAccessibleWorkspaces } = await import('./workspaces')
	const { workspaceSchema } = await import('../storage/schemas')
	const { getCorePortfolioStorageDirectory, openCorePortfolioStorage } = await import('../core/storage')

	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness(
		'gorchestra-server-workspace-provisioning-',
	)
	const testNow = new Date('2026-06-19T12:00:00.000Z')
	const missingUserId = '01k00000000000000000000051'
	const secretEncryptionKey = Buffer.alloc(32, 1)

	afterEach(cleanupTempServerStorage)

	async function withProvisioningStorage<T>(run: (input: { serverStorage: ServerStorage; dataDir: string }) => Promise<T>): Promise<T> {
		const dataDir = await createTempServerDataDir()
		const serverStorage = await openServerStorage({ dataDir })
		try {
			return await run({ serverStorage, dataDir })
		} finally {
			await serverStorage.close()
		}
	}

	async function testProvisionsDefaultWorkspacePortfolio(): Promise<void> {
		await withProvisioningStorage(async ({ serverStorage, dataDir }) => {
			const user = await createUser({ serverStorage, now: testNow })
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/provisioned-default'

			const result = await provisionWorkspaceWithDefaultPortfolio({
				serverStorage,
				userId: user.id,
				workspaceDisplayName: '  Delivery Ops  ',
				portfolioDisplayName: '  Main Portfolio  ',
				corePortfolioStorage,
				now: testNow,
				secretEncryptionKey,
				coreStorageNamespaceFactory: () => coreStorageNamespace,
			})

			expect(result.workspace).toMatchObject({ displayName: 'Delivery Ops', createdAt: testNow.toISOString() })
			expect(result.workspaceMember).toMatchObject({
				workspaceId: result.workspace.id,
				userId: user.id,
				membershipStartedAt: testNow.toISOString(),
				membershipEndedAt: null,
			})
			expect(result.workspaceOwnerRole).toMatchObject({
				workspaceId: result.workspace.id,
				workspaceMemberId: result.workspaceMember.id,
				assignedAt: testNow.toISOString(),
				revokedAt: null,
			})
			expect(result.portfolio).toMatchObject({
				workspaceId: result.workspace.id,
				displayName: 'Main Portfolio',
				coreStorageNamespace,
				registeredAt: testNow.toISOString(),
			})

			const accessible = await listAccessibleWorkspaces({ serverStorage, userId: user.id })
			expect(accessible.items).toHaveLength(1)
			expect(accessible.items[0]).toMatchObject({
				...result.workspace,
				member: result.workspaceMember,
				ownerRole: result.workspaceOwnerRole,
				portfolios: [result.portfolio],
			})

			const coreStorage = await openCorePortfolioStorage({ config: corePortfolioStorage, coreStorageNamespace })
			try {
				expect(await coreStorage.adapter.loadMigrations()).toEqual([
					expect.objectContaining({ id: '2026-06-16-0001-create-core-storage' }),
				])
			} finally {
				await coreStorage.close()
			}
		})
	}

	async function testRejectsEmptyDisplayNamesBeforeCreatingCoreStorage(): Promise<void> {
		await withProvisioningStorage(async ({ serverStorage, dataDir }) => {
			const user = await createUser({ serverStorage, now: testNow })
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/empty-name'

			await expect(
				provisionWorkspaceWithDefaultPortfolio({
					serverStorage,
					userId: user.id,
					workspaceDisplayName: '  ',
					portfolioDisplayName: 'Main Portfolio',
					corePortfolioStorage,
					now: testNow,
					secretEncryptionKey,
					coreStorageNamespaceFactory: () => coreStorageNamespace,
				}),
			).rejects.toThrow('Workspace display name is required')
			expect(existsSync(getCorePortfolioStorageDirectory(corePortfolioStorage, coreStorageNamespace))).toBe(false)
		})
	}

	async function testCleansCoreStorageWhenServerRegistryFails(): Promise<void> {
		await withProvisioningStorage(async ({ serverStorage, dataDir }) => {
			const corePortfolioStorage = { type: 'json' as const, dataDir }
			const coreStorageNamespace = 'portfolios/server-registry-failure'

			await expect(
				provisionWorkspaceWithDefaultPortfolio({
					serverStorage,
					userId: missingUserId,
					workspaceDisplayName: 'Delivery Ops',
					portfolioDisplayName: 'Main Portfolio',
					corePortfolioStorage,
					now: testNow,
					secretEncryptionKey,
					coreStorageNamespaceFactory: () => coreStorageNamespace,
				}),
			).rejects.toThrow()

			expect(existsSync(getCorePortfolioStorageDirectory(corePortfolioStorage, coreStorageNamespace))).toBe(false)
			expect(await serverStorage.repo.on(workspaceSchema).all().find()).toEqual([])
		})
	}

	describe('Workspace Provisioning module', () => {
		it(
			'creates an Active Workspace Owner and registered Default Portfolio backed by Core storage',
			testProvisionsDefaultWorkspacePortfolio,
		)
		it('rejects empty display names before creating Core storage', testRejectsEmptyDisplayNamesBeforeCreatingCoreStorage)
		it('cleans up Core storage when Server registry creation fails', testCleansCoreStorageWhenServerRegistryFails)
	})
}
