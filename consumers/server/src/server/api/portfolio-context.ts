import { openCore, type GorchestraCore } from '@gorchestra/core'
import { PreconditionRequiredError } from 'equipped/errors'

import type { ServerApiContext } from './context'
import { throwCoreOperationError, throwNotAuthorized, throwSelectionRequired, throwSessionAuthenticationError } from './errors'
import { authenticateApiSession, getSessionToken, type ApiSessionAuthentication } from './session'
import { createCoreServices } from '../core/services'
import { openCorePortfolioStorage } from '../core/storage'
import { resolveSelectionAccess, type SelectionAccessResult } from '../modules/selection-access'
import { selectionCookieName, type SelectedPortfolio } from '../modules/selection-cookie'
import type { ServerSession } from '../modules/sessions'
import type { PortfolioRegistryEntry, Workspace, WorkspaceMember, WorkspaceOwnerRole } from '../storage/schemas'

export type SelectedPortfolioCoreContext = {
	session: ServerSession
	selection: SelectedPortfolio
	workspace: Workspace
	workspaceMember: WorkspaceMember
	portfolio: PortfolioRegistryEntry
	activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
	core: GorchestraCore
}

export type SelectedPortfolioOwnerCoreContext = Omit<SelectedPortfolioCoreContext, 'activeWorkspaceOwnerRole'> & {
	activeWorkspaceOwnerRole: WorkspaceOwnerRole
}

type AuthenticatedApiSession = Extract<ApiSessionAuthentication, { authenticated: true }>
type SelectedSelectionAccess = Extract<SelectionAccessResult, { selected: true }>

type ResolvedSelectedPortfolioRequest = {
	authentication: AuthenticatedApiSession
	selectionAccess: SelectedSelectionAccess
}

export async function withSelectedPortfolioCore<T>(
	context: ServerApiContext,
	cookies: Record<string, string | undefined>,
	run: (selectedContext: SelectedPortfolioCoreContext) => Promise<T>,
): Promise<T> {
	const resolved = await resolveSelectedPortfolioRequest(context, cookies)
	const coreStorage = await openCorePortfolioStorage({
		config: context.corePortfolioStorage,
		coreStorageNamespace: resolved.selectionAccess.portfolio.coreStorageNamespace,
	})
	try {
		const core = openSelectedPortfolioCore(coreStorage.storage, context, resolved.selectionAccess.portfolio.coreStorageNamespace)
		return await run(selectedPortfolioCoreContext(resolved, core))
	} finally {
		await coreStorage.close()
	}
}

export async function withSelectedPortfolioOwnerCore<T>(
	context: ServerApiContext,
	cookies: Record<string, string | undefined>,
	run: (selectedContext: SelectedPortfolioOwnerCoreContext) => Promise<T>,
): Promise<T> {
	return withSelectedPortfolioCore(context, cookies, async (selectedContext) => run(requireSelectedPortfolioOwner(selectedContext)))
}

async function resolveSelectedPortfolioRequest(
	context: ServerApiContext,
	cookies: Record<string, string | undefined>,
): Promise<ResolvedSelectedPortfolioRequest> {
	const authentication = await requireAuthenticatedSession(context, cookies)
	return { authentication, selectionAccess: await requireSelectionAccess(context, cookies, authentication) }
}

async function requireAuthenticatedSession(
	context: ServerApiContext,
	cookies: Record<string, string | undefined>,
): Promise<AuthenticatedApiSession> {
	const authentication = await authenticateApiSession(context, getSessionToken(cookies))
	if (!authentication.authenticated) throwSessionAuthenticationError(authentication.reason)
	return authentication
}

async function requireSelectionAccess(
	context: ServerApiContext,
	cookies: Record<string, string | undefined>,
	authentication: AuthenticatedApiSession,
): Promise<SelectedSelectionAccess> {
	const selectionAccess = await resolveSelectionAccess({
		serverStorage: context.serverStorage,
		userId: authentication.session.userId,
		selectionToken: cookies[selectionCookieName] ?? null,
		now: context.now(),
		signingKey: context.security.selectionSigningKey,
	})
	if (!selectionAccess.selected) throwSelectionRequired()
	return selectionAccess
}

function openSelectedPortfolioCore(
	storage: Parameters<typeof createCoreServices>[0],
	context: ServerApiContext,
	coreStorageNamespace: string,
): GorchestraCore {
	const openedCore = openCore(
		createCoreServices(storage, {
			secretEncryptionKey: context.security.secretEncryptionKey,
			sandboxRootDir: context.corePortfolioStorage.dataDir,
			coreStorageNamespace,
			dispatcher: {
				preflight: () => context.dispatcher.preflight(),
				request: (request) => context.dispatcher.request({ coreStorageNamespace, request }),
				ready: (marker) => context.dispatcher.ready(marker),
			},
		}),
	)
	if (!openedCore.ok) throwCoreOperationError(openedCore.error)
	return openedCore.value
}

function selectedPortfolioCoreContext(resolved: ResolvedSelectedPortfolioRequest, core: GorchestraCore): SelectedPortfolioCoreContext {
	return {
		session: resolved.authentication.session,
		selection: resolved.selectionAccess.selection,
		workspace: resolved.selectionAccess.workspace,
		workspaceMember: resolved.selectionAccess.workspaceMember,
		portfolio: resolved.selectionAccess.portfolio,
		activeWorkspaceOwnerRole: resolved.selectionAccess.activeWorkspaceOwnerRole,
		core,
	}
}

function requireSelectedPortfolioOwner(selectedContext: SelectedPortfolioCoreContext): SelectedPortfolioOwnerCoreContext {
	if (selectedContext.activeWorkspaceOwnerRole === null) throwNotAuthorized('Workspace Owner role is required to change Portfolio state')
	return selectedContext as SelectedPortfolioOwnerCoreContext
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('../modules/identities')
	const { buildSelectionCookie } = await import('../modules/selection-cookie')
	const { sessionCookieName, createSession } = await import('../modules/sessions')
	const { provisionWorkspaceWithDefaultPortfolio } = await import('../modules/workspace-provisioning')
	const { createServerApiContext } = await import('./context')

	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness('gorchestra-server-portfolio-context-')
	const now = new Date('2026-06-21T00:00:00.000Z')
	const sessionSigningKey = 'test-portfolio-context-session-key'
	const selectionSigningKey = 'test-portfolio-context-selection-key'
	const secretEncryptionKey = Buffer.alloc(32, 1)

	afterEach(cleanupTempServerStorage)

	describe('Portfolio API context', () => {
		it('opens Core for an authenticated selected Portfolio', async () => {
			await withPortfolioContextFixture(async ({ apiContext, cookies, provisioned, session }) => {
				const result = await withSelectedPortfolioCore(apiContext, cookies, async (selectedContext) => {
					const projects = await selectedContext.core.queries.listProjects({})
					return { selectedContext, projects }
				})

				expect(result.projects).toEqual({ ok: true, value: [] })
				expect(result.selectedContext.session).toEqual(session.session)
				expect(result.selectedContext.workspace).toEqual(provisioned.workspace)
				expect(result.selectedContext.workspaceMember).toEqual(provisioned.workspaceMember)
				expect(result.selectedContext.portfolio).toEqual(provisioned.portfolio)
				expect(result.selectedContext.activeWorkspaceOwnerRole).toEqual(provisioned.workspaceOwnerRole)
			})
		})

		it('maps missing selected Portfolio context to Precondition Required after Session authentication succeeds', async () => {
			await withPortfolioContextFixture(async ({ apiContext, cookies }) => {
				const { [selectionCookieName]: _selectionToken, ...cookiesWithoutSelection } = cookies

				await expect(
					withSelectedPortfolioCore(apiContext, cookiesWithoutSelection, () => Promise.resolve(null)),
				).rejects.toBeInstanceOf(PreconditionRequiredError)
			})
		})

		it('requires Active Workspace Owner authority for owner-scoped Portfolio context', () => {
			const ownerRole = workspaceOwnerRole()

			expect(requireSelectedPortfolioOwner(selectedPortfolioCoreContextFixture(ownerRole)).activeWorkspaceOwnerRole).toEqual(
				ownerRole,
			)
			expect(() => requireSelectedPortfolioOwner(selectedPortfolioCoreContextFixture(null))).toThrow(
				'Workspace Owner role is required to change Portfolio state',
			)
		})
	})

	function selectedPortfolioCoreContextFixture(activeWorkspaceOwnerRole: WorkspaceOwnerRole | null): SelectedPortfolioCoreContext {
		return {
			session: {
				userId: 'user-1',
				email: 'person@example.com',
				sessionId: 'session-1',
				issuedAt: now.toISOString(),
				expiresAt: now.toISOString(),
			},
			selection: {
				workspaceId: 'workspace-1',
				portfolioId: 'portfolio-1',
				issuedAt: now.toISOString(),
				expiresAt: now.toISOString(),
			},
			workspace: { id: 'workspace-1', displayName: 'Workspace', createdAt: now.toISOString() },
			workspaceMember: {
				id: 'member-1',
				workspaceId: 'workspace-1',
				userId: 'user-1',
				membershipStartedAt: now.toISOString(),
				membershipEndedAt: null,
			},
			portfolio: {
				id: 'portfolio-1',
				workspaceId: 'workspace-1',
				displayName: 'Portfolio',
				coreStorageNamespace: 'portfolios/portfolio-1',
				registeredAt: now.toISOString(),
			},
			activeWorkspaceOwnerRole,
			core: {} as GorchestraCore,
		}
	}

	function workspaceOwnerRole(): WorkspaceOwnerRole {
		return {
			id: 'role-1',
			workspaceId: 'workspace-1',
			workspaceMemberId: 'member-1',
			assignedAt: now.toISOString(),
			revokedAt: null,
		}
	}

	async function withPortfolioContextFixture<T>(
		run: (fixture: Awaited<ReturnType<typeof createPortfolioContextFixture>>) => Promise<T>,
	): Promise<T> {
		const fixture = await createPortfolioContextFixture()
		try {
			return await run(fixture)
		} finally {
			await fixture.serverStorage.close()
		}
	}

	async function createPortfolioContextFixture() {
		const dataDir = await createTempServerDataDir()
		const serverStorage = await openServerStorage({ dataDir })
		const serverCache = createTestServerCache()
		const apiContext = createServerApiContext({
			serverStorage,
			serverCache,
			corePortfolioStorage: { type: 'json', dataDir },
			security: {
				sessionSigningKey,
				selectionSigningKey,
				secretEncryptionKey,
			},
			now: () => now,
		})
		const user = await createUser({ serverStorage, now })
		const session = await createSession({
			serverCache,
			userId: user.id,
			email: 'person@example.com',
			now,
			signingKey: sessionSigningKey,
			generateSessionId: () => 'session-1',
		})
		const provisioned = await provisionWorkspaceWithDefaultPortfolio({
			serverStorage,
			userId: user.id,
			workspaceDisplayName: 'Workspace',
			portfolioDisplayName: 'Portfolio',
			corePortfolioStorage: apiContext.corePortfolioStorage,
			now,
			secretEncryptionKey: apiContext.security.secretEncryptionKey,
			coreStorageNamespaceFactory: () => `portfolios/${crypto.randomUUID()}`,
		})
		const selection = buildSelectionCookie({
			workspaceId: provisioned.workspace.id,
			portfolioId: provisioned.portfolio.id,
			now,
			signingKey: selectionSigningKey,
		})
		return {
			serverStorage,
			apiContext,
			user,
			session,
			provisioned,
			cookies: { [sessionCookieName]: session.token, [selectionCookieName]: selection.token },
		}
	}
}
