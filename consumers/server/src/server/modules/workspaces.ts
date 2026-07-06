import { requireServerId } from '../server-id'
import type { ServerPaginatedQueryEnvelope, ServerPaginatedQueryInput } from '../server-pagination'
import { emptyServerPaginatedQueryEnvelope } from '../server-pagination'
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

export type ListAccessibleWorkspacesInput = {
	serverStorage: ServerStorage
	userId: string
	query?: ServerPaginatedQueryInput
}

export type AccessibleWorkspace = Workspace & {
	member: WorkspaceMember
	ownerRole: WorkspaceOwnerRole | null
	portfolios: PortfolioRegistryEntry[]
}

interface PaginatedListQuery {
	orderBy(field: string, direction?: 'asc' | 'desc'): PaginatedListQuery
	limit(limit: number): PaginatedListQuery
	page(page: number): PaginatedListQuery
	paginate(): Promise<unknown>
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

export async function listAccessibleWorkspaces(
	input: ListAccessibleWorkspacesInput,
): Promise<ServerPaginatedQueryEnvelope<AccessibleWorkspace>> {
	await assertUserExists(input.serverStorage, input.userId)
	const activeWorkspaceMembers = await findActiveWorkspaceMembersForUser(input.serverStorage, input.userId)
	if (activeWorkspaceMembers.length === 0) return emptyServerPaginatedQueryEnvelope()

	const workspaces = await findAccessibleWorkspaces(
		input.serverStorage,
		activeWorkspaceMembers.map((workspaceMember) => workspaceMember.workspaceId),
		input.query ?? {},
	)
	return {
		...workspaces,
		items: await hydrateAccessibleWorkspaces(input.serverStorage, activeWorkspaceMembers, workspaces.items),
	}
}

export async function hasAccessibleWorkspacePortfolios(input: Omit<ListAccessibleWorkspacesInput, 'query'>): Promise<boolean> {
	await assertUserExists(input.serverStorage, input.userId)
	const activeWorkspaceMembers = await findActiveWorkspaceMembersForUser(input.serverStorage, input.userId)
	if (activeWorkspaceMembers.length === 0) return false
	const portfolios = await input.serverStorage.repo
		.on(portfolioRegistryEntrySchema)
		.all()
		.where((query) =>
			query.in(
				portfolioRegistryEntrySchema.fields.workspaceId,
				activeWorkspaceMembers.map((workspaceMember) => workspaceMember.workspaceId),
			),
		)
		.limit(1)
		.find()
	return portfolios.length > 0
}

async function findAccessibleWorkspaces(
	serverStorage: ServerStorage,
	workspaceIds: string[],
	pagination: ServerPaginatedQueryInput,
): Promise<ServerPaginatedQueryEnvelope<Workspace>> {
	const baseQuery = serverStorage.repo
		.on(workspaceSchema)
		.all()
		.where((query) =>
			pagination.beforeId === undefined
				? query.in(workspaceSchema.fields.id, workspaceIds)
				: query.and([
						(clause) => clause.in(workspaceSchema.fields.id, workspaceIds),
						(clause) => clause.lt(workspaceSchema.fields.id, pagination.beforeId),
					]),
		)

	let query: PaginatedListQuery = baseQuery.orderBy('id', 'desc')
	if (pagination.limit !== undefined) query = query.limit(pagination.limit)
	if ('page' in pagination && pagination.page !== undefined) query = query.page(pagination.page)
	return (await query.paginate()) as ServerPaginatedQueryEnvelope<Workspace>
}

async function hydrateAccessibleWorkspaces(
	serverStorage: ServerStorage,
	activeWorkspaceMembers: WorkspaceMember[],
	workspaces: Workspace[],
): Promise<AccessibleWorkspace[]> {
	const workspaceMembersByWorkspaceId = new Map(
		activeWorkspaceMembers.map((workspaceMember) => [workspaceMember.workspaceId, workspaceMember]),
	)
	const pageWorkspaceMembers = workspaces.map((workspace) =>
		getRequiredMapValue(workspaceMembersByWorkspaceId, workspace.id, 'Accessible Workspace Member is missing'),
	)
	const activeOwnerRolesByWorkspaceMemberId = await findActiveWorkspaceOwnerRolesByWorkspaceMemberId(
		serverStorage,
		pageWorkspaceMembers.map((workspaceMember) => workspaceMember.id),
	)
	const portfoliosByWorkspaceId = await findPortfolioRegistryEntriesByWorkspaceId(
		serverStorage,
		workspaces.map((workspace) => workspace.id),
	)

	return workspaces.map((workspace) => {
		const member = getRequiredMapValue(workspaceMembersByWorkspaceId, workspace.id, 'Accessible Workspace Member is missing')
		return {
			...workspace,
			member,
			ownerRole: activeOwnerRolesByWorkspaceMemberId.get(member.id) ?? null,
			portfolios: portfoliosByWorkspaceId.get(workspace.id) ?? [],
		}
	})
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

async function findPortfolioRegistryEntriesByWorkspaceId(
	serverStorage: ServerStorage,
	workspaceIds: string[],
): Promise<Map<string, PortfolioRegistryEntry[]>> {
	if (workspaceIds.length === 0) return new Map()
	const portfolios = await serverStorage.repo
		.on(portfolioRegistryEntrySchema)
		.all()
		.where((query) => query.in(portfolioRegistryEntrySchema.fields.workspaceId, workspaceIds))
		.orderBy('id', 'desc')
		.find()
	const portfoliosByWorkspaceId = new Map<string, PortfolioRegistryEntry[]>()
	for (const portfolio of portfolios) {
		const workspacePortfolios = portfoliosByWorkspaceId.get(portfolio.workspaceId) ?? []
		workspacePortfolios.push(portfolio)
		portfoliosByWorkspaceId.set(portfolio.workspaceId, workspacePortfolios)
	}
	return portfoliosByWorkspaceId
}

async function findActiveWorkspaceOwnerRolesByWorkspaceMemberId(
	serverStorage: ServerStorage,
	workspaceMemberIds: string[],
): Promise<Map<string, WorkspaceOwnerRole>> {
	const entries = await Promise.all(
		workspaceMemberIds.map(
			async (workspaceMemberId) => [workspaceMemberId, await findActiveWorkspaceOwnerRole(serverStorage, workspaceMemberId)] as const,
		),
	)
	return new Map(entries.filter((entry): entry is readonly [string, WorkspaceOwnerRole] => entry[1] !== null))
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

function getRequiredMapValue<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, message: string): TValue {
	const value = map.get(key)
	if (value === undefined) throw new Error(message)
	return value
}

function requireIdentifier(value: string, message: string): string {
	return requireServerId(value, message)
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

	async function testListsAccessibleWorkspaces(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const otherUser = await createUser({ serverStorage, now: later(1) })
			const firstWorkspace = await createWorkspace({ serverStorage, displayName: 'First Workspace', now: later(2) })
			const secondWorkspace = await createWorkspace({ serverStorage, displayName: 'Second Workspace', now: later(3) })
			const emptyWorkspace = await createWorkspace({ serverStorage, displayName: 'Empty Workspace', now: later(4) })
			const inaccessibleWorkspace = await createWorkspace({ serverStorage, displayName: 'Inaccessible Workspace', now: later(5) })
			const firstMember = await createWorkspaceMember({
				serverStorage,
				workspaceId: firstWorkspace.id,
				userId: user.id,
				now: later(6),
			})
			const secondMember = await createWorkspaceMember({
				serverStorage,
				workspaceId: secondWorkspace.id,
				userId: user.id,
				now: later(7),
			})
			const emptyMember = await createWorkspaceMember({
				serverStorage,
				workspaceId: emptyWorkspace.id,
				userId: user.id,
				now: later(8),
			})
			await createWorkspaceMember({ serverStorage, workspaceId: inaccessibleWorkspace.id, userId: otherUser.id, now: later(9) })
			const ownerRole = await assignWorkspaceOwnerRole({ serverStorage, workspaceMemberId: firstMember.id, now: later(10) })
			const secondPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: firstWorkspace.id,
				displayName: 'Second Portfolio',
				coreStorageNamespace: 'first-workspace-second-portfolio',
				now: later(11),
			})
			const firstPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: firstWorkspace.id,
				displayName: 'First Portfolio',
				coreStorageNamespace: 'first-workspace-first-portfolio',
				now: later(12),
			})
			const thirdPortfolio = await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: secondWorkspace.id,
				displayName: 'Third Portfolio',
				coreStorageNamespace: 'second-workspace-third-portfolio',
				now: later(13),
			})
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: inaccessibleWorkspace.id,
				displayName: 'Inaccessible Portfolio',
				coreStorageNamespace: 'inaccessible-portfolio',
				now: later(14),
			})

			const accessible = await listAccessibleWorkspaces({ serverStorage, userId: user.id })

			expect(accessible.items.map(({ displayName }) => displayName)).toEqual([
				'Empty Workspace',
				'Second Workspace',
				'First Workspace',
			])
			expect(accessible.items.map(({ id }) => id)).toEqual([emptyWorkspace.id, secondWorkspace.id, firstWorkspace.id])
			expect(accessible.items[0]).toMatchObject({ ...emptyWorkspace, member: emptyMember, ownerRole: null, portfolios: [] })
			expect(accessible.items[1]).toMatchObject({ ...secondWorkspace, member: secondMember, ownerRole: null })
			expect(accessible.items[1]?.portfolios).toEqual([thirdPortfolio])
			expect(accessible.items[2]).toMatchObject({ ...firstWorkspace, member: firstMember, ownerRole })
			expect(accessible.items[2]?.portfolios).toEqual([firstPortfolio, secondPortfolio])
			expect(accessible.pages).toEqual({ current: 1, start: 1, last: 1, previous: null, next: null })
			expect(accessible.docs).toEqual({ limit: 3, total: 3, count: 3 })
		})
	}

	async function testPaginatesAccessibleWorkspaces(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const firstWorkspace = await createWorkspace({ serverStorage, displayName: 'First Workspace', now: later(1) })
			const secondWorkspace = await createWorkspace({ serverStorage, displayName: 'Second Workspace', now: later(2) })
			const thirdWorkspace = await createWorkspace({ serverStorage, displayName: 'Third Workspace', now: later(3) })
			await createWorkspaceMember({ serverStorage, workspaceId: firstWorkspace.id, userId: user.id, now: later(4) })
			await createWorkspaceMember({ serverStorage, workspaceId: secondWorkspace.id, userId: user.id, now: later(5) })
			await createWorkspaceMember({ serverStorage, workspaceId: thirdWorkspace.id, userId: user.id, now: later(6) })
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: firstWorkspace.id,
				displayName: 'First Portfolio',
				coreStorageNamespace: 'first-portfolio',
				now: later(7),
			})
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: secondWorkspace.id,
				displayName: 'Second Portfolio',
				coreStorageNamespace: 'second-portfolio',
				now: later(8),
			})
			await createPortfolioRegistryEntry({
				serverStorage,
				workspaceId: thirdWorkspace.id,
				displayName: 'Third Portfolio',
				coreStorageNamespace: 'third-portfolio',
				now: later(9),
			})

			const firstPage = await listAccessibleWorkspaces({ serverStorage, userId: user.id, query: { limit: 2 } })
			const secondPage = await listAccessibleWorkspaces({
				serverStorage,
				userId: user.id,
				query: { beforeId: firstPage.items[1]?.id, limit: 2 },
			})

			expect(firstPage.items.map(({ id }) => id)).toEqual([thirdWorkspace.id, secondWorkspace.id])
			expect(firstPage.pages.next).toBe(2)
			expect(firstPage.docs).toEqual({ limit: 2, total: 3, count: 2 })
			expect(secondPage.items.map(({ id }) => id)).toEqual([firstWorkspace.id])
			expect(secondPage.pages.next).toBeNull()
			expect(secondPage.docs).toEqual({ limit: 2, total: 1, count: 1 })
		})
	}

	async function testIncludesEmptyWorkspaceWithoutAccessiblePortfolios(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createTestUser(serverStorage)
			const workspace = await createWorkspace({ serverStorage, displayName: 'Empty Workspace', now: testNow })
			const member = await createWorkspaceMember({ serverStorage, workspaceId: workspace.id, userId: user.id, now: later(1) })

			const accessible = await listAccessibleWorkspaces({ serverStorage, userId: user.id })

			expect(accessible.items).toEqual([{ ...workspace, member, ownerRole: null, portfolios: [] }])
			expect(await hasAccessibleWorkspacePortfolios({ serverStorage, userId: user.id })).toBe(false)
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

			expect(await listAccessibleWorkspaces({ serverStorage, userId: user.id })).toEqual(emptyServerPaginatedQueryEnvelope())
			expect(await hasAccessibleWorkspacePortfolios({ serverStorage, userId: user.id })).toBe(false)
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
		it('lists accessible Workspaces for an Active Member in Workspace id-desc order', testListsAccessibleWorkspaces)
		it('paginates accessible Workspaces by Workspace id', testPaginatesAccessibleWorkspaces)
		it('includes Active Member Workspaces without accessible Portfolios', testIncludesEmptyWorkspaceWithoutAccessiblePortfolios)
		it('excludes inactive Workspace Members from accessible Workspaces', testExcludesInactiveWorkspaceMembers)
		it('does not duplicate an active Workspace Owner role assignment', testOwnerRoleAssignmentIsIdempotentWhileActive)
	})
}
