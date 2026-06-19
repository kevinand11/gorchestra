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

export type CreateWorkspaceInput = {
	serverStorage: ServerStorage
	displayName: string
	now: Date
}

export type CreateWorkspaceMemberInput = {
	serverStorage: ServerStorage
	workspaceId: string
	userId: string
	now: Date
}

export type AssignWorkspaceOwnerRoleInput = {
	serverStorage: ServerStorage
	workspaceMemberId: string
	now: Date
}

export type CreatePortfolioRegistryEntryInput = {
	serverStorage: ServerStorage
	workspaceId: string
	displayName: string
	coreStorageNamespace: string
	now: Date
}

export type ListAccessibleWorkspacePortfoliosInput = {
	serverStorage: ServerStorage
	userId: string
}

export type AccessibleWorkspacePortfolio = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	portfolio: PortfolioRegistryEntry
	activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
	return input.serverStorage.repo
		.on(workspaceSchema)
		.one()
		.create({ displayName: input.displayName, createdAt: getTimestamp(input.now) })
}

export async function createWorkspaceMember(input: CreateWorkspaceMemberInput): Promise<WorkspaceMember> {
	await assertUserExists(input.serverStorage, input.userId)
	await assertWorkspaceExists(input.serverStorage, input.workspaceId)
	return input.serverStorage.repo
		.on(workspaceMemberSchema)
		.one()
		.create({
			workspaceId: input.workspaceId,
			userId: input.userId,
			membershipStartedAt: getTimestamp(input.now),
			membershipEndedAt: null,
		})
}

export async function assignWorkspaceOwnerRole(input: AssignWorkspaceOwnerRoleInput): Promise<WorkspaceOwnerRole> {
	const workspaceMember = await input.serverStorage.repo.on(workspaceMemberSchema).one().id(input.workspaceMemberId).required().find()
	assertActiveWorkspaceMember(workspaceMember)
	const existingActiveRole = await findActiveWorkspaceOwnerRole(input.serverStorage, workspaceMember.id)
	if (existingActiveRole) return existingActiveRole
	return input.serverStorage.repo
		.on(workspaceOwnerRoleSchema)
		.one()
		.create({
			workspaceId: workspaceMember.workspaceId,
			workspaceMemberId: workspaceMember.id,
			assignedAt: getTimestamp(input.now),
			revokedAt: null,
		})
}

export async function createPortfolioRegistryEntry(input: CreatePortfolioRegistryEntryInput): Promise<PortfolioRegistryEntry> {
	await assertWorkspaceExists(input.serverStorage, input.workspaceId)
	return input.serverStorage.repo
		.on(portfolioRegistryEntrySchema)
		.one()
		.create({
			workspaceId: input.workspaceId,
			displayName: input.displayName,
			coreStorageNamespace: input.coreStorageNamespace,
			registeredAt: getTimestamp(input.now),
		})
}

export async function listAccessibleWorkspacePortfolios(
	input: ListAccessibleWorkspacePortfoliosInput,
): Promise<AccessibleWorkspacePortfolio[]> {
	await assertUserExists(input.serverStorage, input.userId)
	const activeWorkspaceMembers = await findActiveWorkspaceMembersForUser(input.serverStorage, input.userId)
	const accessible = await Promise.all(
		activeWorkspaceMembers.map((workspaceMember) => listWorkspaceMemberPortfolioAccess(input.serverStorage, workspaceMember)),
	)
	return sortAccessibleWorkspacePortfolios(accessible.flat())
}

async function listWorkspaceMemberPortfolioAccess(
	serverStorage: ServerStorage,
	workspaceMember: WorkspaceMember,
): Promise<AccessibleWorkspacePortfolio[]> {
	const [workspace, portfolios, activeWorkspaceOwnerRole] = await Promise.all([
		serverStorage.repo.on(workspaceSchema).one().id(workspaceMember.workspaceId).required().find(),
		findPortfolioRegistryEntriesForWorkspace(serverStorage, workspaceMember.workspaceId),
		findActiveWorkspaceOwnerRole(serverStorage, workspaceMember.id),
	])
	return portfolios.map((portfolio) => ({ workspace, workspaceMember, portfolio, activeWorkspaceOwnerRole }))
}

async function assertUserExists(serverStorage: ServerStorage, userId: string): Promise<ServerUser> {
	return serverStorage.repo.on(userSchema).one().id(requireIdentifier(userId, 'User id is required')).required().find()
}

async function assertWorkspaceExists(serverStorage: ServerStorage, workspaceId: string): Promise<Workspace> {
	return serverStorage.repo.on(workspaceSchema).one().id(requireIdentifier(workspaceId, 'Workspace id is required')).required().find()
}

async function findActiveWorkspaceMembersForUser(serverStorage: ServerStorage, userId: string): Promise<WorkspaceMember[]> {
	const members = await serverStorage.repo
		.on(workspaceMemberSchema)
		.all()
		.where((query) => query.eq(workspaceMemberSchema.fields.userId, requireIdentifier(userId, 'User id is required')))
		.find()
	return members.filter(isActiveWorkspaceMember)
}

async function findPortfolioRegistryEntriesForWorkspace(
	serverStorage: ServerStorage,
	workspaceId: string,
): Promise<PortfolioRegistryEntry[]> {
	return serverStorage.repo
		.on(portfolioRegistryEntrySchema)
		.all()
		.where((query) => query.eq(portfolioRegistryEntrySchema.fields.workspaceId, workspaceId))
		.find()
}

async function findActiveWorkspaceOwnerRole(serverStorage: ServerStorage, workspaceMemberId: string): Promise<WorkspaceOwnerRole | null> {
	const roles = await serverStorage.repo
		.on(workspaceOwnerRoleSchema)
		.all()
		.where((query) => query.eq(workspaceOwnerRoleSchema.fields.workspaceMemberId, workspaceMemberId))
		.find()
	return roles.find(isActiveWorkspaceOwnerRole) ?? null
}

function assertActiveWorkspaceMember(workspaceMember: WorkspaceMember): void {
	if (!isActiveWorkspaceMember(workspaceMember)) throw new Error('Workspace Owner role requires an Active Member')
}

function isActiveWorkspaceMember(workspaceMember: WorkspaceMember): boolean {
	return workspaceMember.membershipEndedAt === null
}

function isActiveWorkspaceOwnerRole(workspaceOwnerRole: WorkspaceOwnerRole): boolean {
	return workspaceOwnerRole.revokedAt === null
}

function sortAccessibleWorkspacePortfolios(accessible: AccessibleWorkspacePortfolio[]): AccessibleWorkspacePortfolio[] {
	return [...accessible].sort(compareAccessibleWorkspacePortfolios)
}

function compareAccessibleWorkspacePortfolios(left: AccessibleWorkspacePortfolio, right: AccessibleWorkspacePortfolio): number {
	return (
		left.workspace.createdAt.localeCompare(right.workspace.createdAt) ||
		left.portfolio.registeredAt.localeCompare(right.portfolio.registeredAt) ||
		left.workspace.id.localeCompare(right.workspace.id) ||
		left.portfolio.id.localeCompare(right.portfolio.id)
	)
}

function requireIdentifier(value: string, message: string): string {
	if (!value.trim()) throw new Error(message)
	return value
}

function getTimestamp(now: Date): string {
	return now.toISOString()
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { createUser } = await import('./identities')

	const { cleanupTempServerStorage, withTempServerStorage } = createTempServerStorageTestHarness('gorchestra-server-workspaces-')
	const testNow = new Date('2026-06-19T12:00:00.000Z')

	afterEach(cleanupTempServerStorage)

	function later(seconds: number): Date {
		return new Date(testNow.getTime() + seconds * 1000)
	}

	async function createTestUser(serverStorage: ServerStorage): Promise<ServerUser> {
		return createUser({ serverStorage, now: testNow })
	}

	async function testCreatesWorkspaceRegistryRecords(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const workspace = await createWorkspace({ serverStorage, displayName: '  Delivery Ops  ', now: testNow })
			const member = await createWorkspaceMember({ serverStorage, workspaceId: workspace.id, userId: user.id, now: later(1) })
			const ownerRole = await assignWorkspaceOwnerRole({ serverStorage, workspaceMemberId: member.id, now: later(2) })
			const portfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: workspace.id,
				displayName: '  Default Portfolio  ',
				coreStorageNamespace: '  core-namespace-1  ',
				now: later(3),
			})

			expect(workspace).toMatchObject({ displayName: 'Delivery Ops', createdAt: testNow.toISOString() })
			expect(member).toMatchObject({
				workspaceId: workspace.id,
				userId: user.id,
				membershipStartedAt: later(1).toISOString(),
				membershipEndedAt: null,
			})
			expect(ownerRole).toMatchObject({
				workspaceId: workspace.id,
				workspaceMemberId: member.id,
				assignedAt: later(2).toISOString(),
				revokedAt: null,
			})
			expect(portfolio).toMatchObject({
				workspaceId: workspace.id,
				displayName: 'Default Portfolio',
				coreStorageNamespace: 'core-namespace-1',
				registeredAt: later(3).toISOString(),
			})
		})
	}

	async function testListsAccessibleWorkspacePortfolios(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const otherUser = await createUser({ serverStorage, now: later(1) })
			const firstWorkspace = await createWorkspace({ serverStorage, displayName: 'First Workspace', now: later(2) })
			const secondWorkspace = await createWorkspace({ serverStorage, displayName: 'Second Workspace', now: later(3) })
			const inaccessibleWorkspace = await createWorkspace({ serverStorage, displayName: 'Inaccessible Workspace', now: later(4) })
			const firstMember = await createWorkspaceMember({
				serverStorage,
				workspaceId: firstWorkspace.id,
				userId: user.id,
				now: later(5),
			})
			await createWorkspaceMember({ serverStorage, workspaceId: secondWorkspace.id, userId: user.id, now: later(6) })
			await createWorkspaceMember({ serverStorage, workspaceId: inaccessibleWorkspace.id, userId: otherUser.id, now: later(7) })
			const ownerRole = await assignWorkspaceOwnerRole({ serverStorage, workspaceMemberId: firstMember.id, now: later(8) })
			const secondPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: firstWorkspace.id,
				displayName: 'Second Portfolio',
				coreStorageNamespace: 'first-workspace-second-portfolio',
				now: later(10),
			})
			const firstPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: firstWorkspace.id,
				displayName: 'First Portfolio',
				coreStorageNamespace: 'first-workspace-first-portfolio',
				now: later(9),
			})
			const thirdPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: secondWorkspace.id,
				displayName: 'Third Portfolio',
				coreStorageNamespace: 'second-workspace-third-portfolio',
				now: later(11),
			})
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: inaccessibleWorkspace.id,
				displayName: 'Inaccessible Portfolio',
				coreStorageNamespace: 'inaccessible-portfolio',
				now: later(12),
			})

			const accessible = await listAccessibleWorkspacePortfolios({ serverStorage, userId: user.id })

			expect(accessible.map(({ workspace, portfolio }) => [workspace.displayName, portfolio.displayName])).toEqual([
				['First Workspace', 'First Portfolio'],
				['First Workspace', 'Second Portfolio'],
				['Second Workspace', 'Third Portfolio'],
			])
			expect(accessible.map(({ portfolio }) => portfolio.id)).toEqual([firstPortfolio.id, secondPortfolio.id, thirdPortfolio.id])
			expect(accessible[0]?.activeWorkspaceOwnerRole).toEqual(ownerRole)
			expect(accessible[1]?.activeWorkspaceOwnerRole).toEqual(ownerRole)
			expect(accessible[2]?.activeWorkspaceOwnerRole).toBeNull()
		})
	}

	async function testExcludesInactiveWorkspaceMembers(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const workspace = await createWorkspace({ serverStorage, displayName: 'Inactive Workspace', now: testNow })
			const member = await createWorkspaceMember({ serverStorage, workspaceId: workspace.id, userId: user.id, now: later(1) })
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: workspace.id,
				displayName: 'Inactive Portfolio',
				coreStorageNamespace: 'inactive-portfolio',
				now: later(2),
			})
			await serverStorage.repo
				.on(workspaceMemberSchema)
				.one()
				.id(member.id)
				.required()
				.update({ membershipEndedAt: later(3).toISOString() })

			expect(await listAccessibleWorkspacePortfolios({ serverStorage, userId: user.id })).toEqual([])
		})
	}

	async function testOwnerRoleAssignmentIsIdempotentWhileActive(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const workspace = await createWorkspace({ serverStorage, displayName: 'Owner Workspace', now: testNow })
			const member = await createWorkspaceMember({ serverStorage, workspaceId: workspace.id, userId: user.id, now: later(1) })
			const first = await assignWorkspaceOwnerRole({ serverStorage, workspaceMemberId: member.id, now: later(2) })
			const second = await assignWorkspaceOwnerRole({ serverStorage, workspaceMemberId: member.id, now: later(3) })

			expect(second).toEqual(first)
		})
	}

	describe('Workspace registry module', () => {
		it(
			'creates Workspace, Workspace Member, Workspace Owner role, and Portfolio Registry Entry records',
			testCreatesWorkspaceRegistryRecords,
		)
		it('lists accessible Workspace and Portfolio pairs for an Active Member', testListsAccessibleWorkspacePortfolios)
		it('excludes inactive Workspace Members from accessible Workspace and Portfolio pairs', testExcludesInactiveWorkspaceMembers)
		it('does not duplicate an active Workspace Owner role assignment', testOwnerRoleAssignmentIsIdempotentWhileActive)
	})
}
