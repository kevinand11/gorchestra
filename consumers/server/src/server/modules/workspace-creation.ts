import { assignWorkspaceOwnerRole, createWorkspace, createWorkspaceMember } from './workspaces'
import type { ServerStorage } from '../storage/repo'
import type { Workspace, WorkspaceMember, WorkspaceOwnerRole } from '../storage/schemas'

export type CreateWorkspaceForUserInput = {
	serverStorage: ServerStorage
	userId: string
	displayName: string
	now: Date
}

export type CreateWorkspaceForUserResult = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	workspaceOwnerRole: WorkspaceOwnerRole
}

export async function createWorkspaceForUser(input: CreateWorkspaceForUserInput): Promise<CreateWorkspaceForUserResult> {
	return await input.serverStorage.repo.session(async () => {
		const workspace = await createWorkspace({ serverStorage: input.serverStorage, displayName: input.displayName, now: input.now })
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

		return { workspace, workspaceMember, workspaceOwnerRole }
	})
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { createUser } = await import('./identities')
	const { listAccessibleWorkspaces } = await import('./workspaces')
	const { workspaceSchema } = await import('../storage/schemas')

	const { cleanupTempServerStorage, withTempServerStorage } = createTempServerStorageTestHarness('gorchestra-workspace-creation-')
	const testNow = new Date('2026-07-07T10:00:00.000Z')
	const missingUserId = '01k00000000000000000000061'

	afterEach(cleanupTempServerStorage)

	async function testCreatesOwnedWorkspaceForUser(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			const user = await createUser({ serverStorage, now: testNow })

			const result = await createWorkspaceForUser({
				serverStorage,
				userId: user.id,
				displayName: '  Delivery Ops  ',
				now: testNow,
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
			expect(await listAccessibleWorkspaces({ serverStorage, userId: user.id })).toEqual([
				{ ...result.workspace, member: result.workspaceMember, ownerRole: result.workspaceOwnerRole, portfolios: [] },
			])
		})
	}

	async function testRollsBackWorkspaceCreationWhenOwnerCannotBeCreated(): Promise<void> {
		await withTempServerStorage(async (serverStorage) => {
			await expect(
				createWorkspaceForUser({ serverStorage, userId: missingUserId, displayName: 'Delivery Ops', now: testNow }),
			).rejects.toThrow()
			expect(await serverStorage.repo.on(workspaceSchema).all().find()).toEqual([])
		})
	}

	describe('Workspace Creation module', () => {
		it('creates a Workspace, Workspace Member, and Workspace Owner role for a signed-in User', testCreatesOwnedWorkspaceForUser)
		it('rolls back Workspace creation when ownership setup fails', testRollsBackWorkspaceCreationWhenOwnerCannotBeCreated)
	})
}
