import { verifySelectionToken, type SelectedPortfolio } from './selection-cookie'
import type { ServerStorage } from '../storage/repo'
import {
	portfolioRegistryEntrySchema,
	userSchema,
	workspaceMemberSchema,
	workspaceOwnerRoleSchema,
	workspaceSchema,
	type PortfolioRegistryEntry,
	type ServerUser,
	type Workspace,
	type WorkspaceMember,
	type WorkspaceOwnerRole,
} from '../storage/schemas'

export type WorkspacePortfolioSelection = {
	workspaceId: string
	portfolioId: string
}

export type ValidateWorkspacePortfolioAccessInput = {
	serverStorage: ServerStorage
	userId: string
	selection: WorkspacePortfolioSelection
}

export type WorkspacePortfolioAccessFailureReason = 'user-not-found' | 'workspace-not-found' | 'not-active-member' | 'portfolio-not-found'

export type WorkspacePortfolioAccessResult =
	| {
			accessible: true
			workspace: Workspace
			workspaceMember: WorkspaceMember
			portfolio: PortfolioRegistryEntry
			activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
	  }
	| { accessible: false; reason: WorkspacePortfolioAccessFailureReason }

export type ResolveSelectionAccessInput = {
	serverStorage: ServerStorage
	userId: string
	selectionToken?: string | null
	now: Date
	signingKey?: string
}

export type SelectionAccessFailureReason = 'missing-token' | 'invalid-token' | 'expired' | WorkspacePortfolioAccessFailureReason

export type SelectionAccessResult =
	| {
			selected: true
			selection: SelectedPortfolio
			workspace: Workspace
			workspaceMember: WorkspaceMember
			portfolio: PortfolioRegistryEntry
			activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
	  }
	| { selected: false; reason: SelectionAccessFailureReason }

export async function resolveSelectionAccess(input: ResolveSelectionAccessInput): Promise<SelectionAccessResult> {
	return resolveVerifiedSelectionAccess(input, verifySelectionToken(buildVerifySelectionTokenInput(input)))
}

export async function validateWorkspacePortfolioAccess(
	input: ValidateWorkspacePortfolioAccessInput,
): Promise<WorkspacePortfolioAccessResult> {
	return validateExistingUserAccess(input, await findUser(input.serverStorage, input.userId))
}

async function resolveVerifiedSelectionAccess(
	input: ResolveSelectionAccessInput,
	verifiedSelection: ReturnType<typeof verifySelectionToken>,
): Promise<SelectionAccessResult> {
	if (!verifiedSelection.selected) return { selected: false, reason: verifiedSelection.reason }
	return selectionAccessFromWorkspacePortfolioAccess(
		verifiedSelection.selection,
		await validateWorkspacePortfolioAccess({
			serverStorage: input.serverStorage,
			userId: input.userId,
			selection: verifiedSelection.selection,
		}),
	)
}

function selectionAccessFromWorkspacePortfolioAccess(
	selection: SelectedPortfolio,
	access: WorkspacePortfolioAccessResult,
): SelectionAccessResult {
	if (!access.accessible) return { selected: false, reason: access.reason }
	return {
		selected: true,
		selection,
		workspace: access.workspace,
		workspaceMember: access.workspaceMember,
		portfolio: access.portfolio,
		activeWorkspaceOwnerRole: access.activeWorkspaceOwnerRole,
	}
}

async function validateExistingUserAccess(
	input: ValidateWorkspacePortfolioAccessInput,
	user: ServerUser | null,
): Promise<WorkspacePortfolioAccessResult> {
	if (!user) return { accessible: false, reason: 'user-not-found' }
	return validateExistingWorkspaceAccess(input, await findWorkspace(input.serverStorage, input.selection.workspaceId))
}

async function validateExistingWorkspaceAccess(
	input: ValidateWorkspacePortfolioAccessInput,
	workspace: Workspace | null,
): Promise<WorkspacePortfolioAccessResult> {
	if (!workspace) return { accessible: false, reason: 'workspace-not-found' }
	return validateActiveMembershipAccess(
		input,
		workspace,
		await findActiveWorkspaceMember(input.serverStorage, input.userId, workspace.id),
	)
}

async function validateActiveMembershipAccess(
	input: ValidateWorkspacePortfolioAccessInput,
	workspace: Workspace,
	workspaceMember: WorkspaceMember | null,
): Promise<WorkspacePortfolioAccessResult> {
	if (!workspaceMember) return { accessible: false, reason: 'not-active-member' }
	return validateRegisteredPortfolioAccess(
		input,
		workspace,
		workspaceMember,
		await findPortfolio(input.serverStorage, input.selection.portfolioId),
	)
}

async function validateRegisteredPortfolioAccess(
	input: ValidateWorkspacePortfolioAccessInput,
	workspace: Workspace,
	workspaceMember: WorkspaceMember,
	portfolio: PortfolioRegistryEntry | null,
): Promise<WorkspacePortfolioAccessResult> {
	if (!portfolio || portfolio.workspaceId !== workspace.id) return { accessible: false, reason: 'portfolio-not-found' }
	const activeWorkspaceOwnerRole = await findActiveWorkspaceOwnerRole(input.serverStorage, workspaceMember.id)
	return { accessible: true, workspace, workspaceMember, portfolio, activeWorkspaceOwnerRole }
}

function buildVerifySelectionTokenInput(input: ResolveSelectionAccessInput): Parameters<typeof verifySelectionToken>[0] {
	return {
		token: input.selectionToken ?? null,
		now: input.now,
		...(input.signingKey !== undefined ? { signingKey: input.signingKey } : {}),
	}
}

async function findUser(serverStorage: ServerStorage, userId: string): Promise<ServerUser | null> {
	return serverStorage.repo.on(userSchema).one().id(userId).find()
}

async function findWorkspace(serverStorage: ServerStorage, workspaceId: string): Promise<Workspace | null> {
	return serverStorage.repo.on(workspaceSchema).one().id(workspaceId).find()
}

async function findPortfolio(serverStorage: ServerStorage, portfolioId: string): Promise<PortfolioRegistryEntry | null> {
	return serverStorage.repo.on(portfolioRegistryEntrySchema).one().id(portfolioId).find()
}

async function findActiveWorkspaceMember(
	serverStorage: ServerStorage,
	userId: string,
	workspaceId: string,
): Promise<WorkspaceMember | null> {
	const members = await serverStorage.repo
		.on(workspaceMemberSchema)
		.all()
		.where((query) =>
			query.and([
				(clause) => clause.eq(workspaceMemberSchema.fields.userId, userId),
				(clause) => clause.eq(workspaceMemberSchema.fields.workspaceId, workspaceId),
			]),
		)
		.find()
	return members.find(isActiveWorkspaceMember) ?? null
}

async function findActiveWorkspaceOwnerRole(serverStorage: ServerStorage, workspaceMemberId: string): Promise<WorkspaceOwnerRole | null> {
	const roles = await serverStorage.repo
		.on(workspaceOwnerRoleSchema)
		.all()
		.where((query) => query.eq(workspaceOwnerRoleSchema.fields.workspaceMemberId, workspaceMemberId))
		.find()
	return roles.find(isActiveWorkspaceOwnerRole) ?? null
}

function isActiveWorkspaceMember(workspaceMember: WorkspaceMember): boolean {
	return workspaceMember.membershipEndedAt === null
}

function isActiveWorkspaceOwnerRole(workspaceOwnerRole: WorkspaceOwnerRole): boolean {
	return workspaceOwnerRole.revokedAt === null
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { workspaceMemberSchema: testWorkspaceMemberSchema } = await import('../storage/schemas')
	const { createUser } = await import('./identities')
	const { buildSelectionCookie, selectionLifetimeSeconds } = await import('./selection-cookie')
	const { assignWorkspaceOwnerRole, createPortfolioRegistryEntry, createWorkspace, createWorkspaceMember } = await import('./workspaces')

	const { cleanupTempServerStorage, withTempServerStorage } = createTempServerStorageTestHarness('gorchestra-server-selection-access-')
	const testNow = new Date('2026-06-19T12:00:00.000Z')
	const signingKey = 'test-selection-access-signing-key'

	afterEach(cleanupTempServerStorage)

	async function createAccessiblePortfolio(serverStorage: ServerStorage) {
		const user = await createUser({ serverStorage, now: testNow })
		const workspace = await createWorkspace({ serverStorage, displayName: 'Workspace', now: testNow })
		const workspaceMember = await createWorkspaceMember({ serverStorage, workspaceId: workspace.id, userId: user.id, now: testNow })
		const activeWorkspaceOwnerRole = await assignWorkspaceOwnerRole({
			serverStorage,
			workspaceMemberId: workspaceMember.id,
			now: testNow,
		})
		const portfolio = await createPortfolioRegistryEntry({
			serverStorage,
			workspaceId: workspace.id,
			displayName: 'Portfolio',
			coreStorageNamespace: `portfolios/${portfolioNamespaceSuffix()}`,
			now: testNow,
		})
		return { user, workspace, workspaceMember, activeWorkspaceOwnerRole, portfolio }
	}

	function portfolioNamespaceSuffix(): string {
		return crypto.randomUUID()
	}

	async function testResolvesAccessibleSelectionCookie(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)
			const builtSelection = buildSelectionCookie({
				workspaceId: records.workspace.id,
				portfolioId: records.portfolio.id,
				now: testNow,
				signingKey,
			})

			await expect(
				resolveSelectionAccess({
					serverStorage,
					userId: records.user.id,
					selectionToken: builtSelection.token,
					now: testNow,
					signingKey,
				}),
			).resolves.toEqual({
				selected: true,
				selection: builtSelection.selection,
				workspace: records.workspace,
				workspaceMember: records.workspaceMember,
				portfolio: records.portfolio,
				activeWorkspaceOwnerRole: records.activeWorkspaceOwnerRole,
			})
		})
	}

	async function testSelectionTokenFailures(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)
			const builtSelection = buildSelectionCookie({
				workspaceId: records.workspace.id,
				portfolioId: records.portfolio.id,
				now: testNow,
				signingKey,
			})
			const afterExpiry = new Date(testNow.getTime() + selectionLifetimeSeconds * 1000)

			await expect(
				resolveSelectionAccess({ serverStorage, userId: records.user.id, selectionToken: null, now: testNow, signingKey }),
			).resolves.toEqual({ selected: false, reason: 'missing-token' })
			await expect(
				resolveSelectionAccess({
					serverStorage,
					userId: records.user.id,
					selectionToken: `${builtSelection.token}x`,
					now: testNow,
					signingKey,
				}),
			).resolves.toEqual({ selected: false, reason: 'invalid-token' })
			await expect(
				resolveSelectionAccess({
					serverStorage,
					userId: records.user.id,
					selectionToken: builtSelection.token,
					now: afterExpiry,
					signingKey,
				}),
			).resolves.toEqual({ selected: false, reason: 'expired' })
		})
	}

	async function testUserMustExist(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)

			await expect(
				validateWorkspacePortfolioAccess({
					serverStorage,
					userId: 'missing-user',
					selection: { workspaceId: records.workspace.id, portfolioId: records.portfolio.id },
				}),
			).resolves.toEqual({ accessible: false, reason: 'user-not-found' })
		})
	}

	async function testWorkspaceMustExist(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)

			await expect(
				validateWorkspacePortfolioAccess({
					serverStorage,
					userId: records.user.id,
					selection: { workspaceId: 'missing-workspace', portfolioId: records.portfolio.id },
				}),
			).resolves.toEqual({ accessible: false, reason: 'workspace-not-found' })
		})
	}

	async function testWorkspaceMembershipMustBeActive(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)
			await serverStorage.repo
				.on(testWorkspaceMemberSchema)
				.one()
				.id(records.workspaceMember.id)
				.required()
				.update({ membershipEndedAt: testNow.toISOString() })

			await expect(
				validateWorkspacePortfolioAccess({
					serverStorage,
					userId: records.user.id,
					selection: { workspaceId: records.workspace.id, portfolioId: records.portfolio.id },
				}),
			).resolves.toEqual({ accessible: false, reason: 'not-active-member' })
		})
	}

	async function testPortfolioMustExistInsideSelectedWorkspace(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const records = await createAccessiblePortfolio(serverStorage)
			const otherWorkspace = await createWorkspace({ serverStorage, displayName: 'Other Workspace', now: testNow })
			const otherPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: otherWorkspace.id,
				displayName: 'Other Portfolio',
				coreStorageNamespace: `portfolios/${portfolioNamespaceSuffix()}`,
				now: testNow,
			})

			await expect(
				validateWorkspacePortfolioAccess({
					serverStorage,
					userId: records.user.id,
					selection: { workspaceId: records.workspace.id, portfolioId: 'missing-portfolio' },
				}),
			).resolves.toEqual({ accessible: false, reason: 'portfolio-not-found' })
			await expect(
				validateWorkspacePortfolioAccess({
					serverStorage,
					userId: records.user.id,
					selection: { workspaceId: records.workspace.id, portfolioId: otherPortfolio.id },
				}),
			).resolves.toEqual({ accessible: false, reason: 'portfolio-not-found' })
		})
	}

	describe('Selection access module', () => {
		it('resolves a valid Selection Cookie to an accessible Workspace and Portfolio', testResolvesAccessibleSelectionCookie)
		it('returns structured Selection Cookie failure reasons', testSelectionTokenFailures)
		it('requires the signed-in User to exist', testUserMustExist)
		it('requires the selected Workspace to exist', testWorkspaceMustExist)
		it('requires an Active Workspace Member for the signed-in User', testWorkspaceMembershipMustBeActive)
		it('requires the selected Portfolio to be registered inside the selected Workspace', testPortfolioMustExistInsideSelectedWorkspace)
	})
}
