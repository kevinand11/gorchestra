import type { GorchestraCore } from '@gorchestra/core'
import { PreconditionRequiredError } from 'equipped/errors'

import type { ServerApiContext } from './context'
import { throwNotAuthorized, throwPortfolioCoreUnavailable, throwSelectionRequired, throwSessionAuthenticationError } from './errors'
import { authenticateApiSession, getSessionToken, type ApiSessionAuthentication } from './session'
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
	const borrowed = await context.portfolioCores.borrow(resolved.selectionAccess.portfolio.id, async (core) =>
		run(selectedPortfolioCoreContext(resolved, core)),
	)
	if (!borrowed.ok) throwPortfolioCoreUnavailable()
	return borrowed.value
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
	const { afterEach, describe, expect, it, vi } = import.meta.vitest
	const { defaultDispatchProcessorOptions } = await import('@gorchestra/core')
	const { defaultPortfolioCoreSupervisionConfig } = await import('../config')
	const { createPortfolioCoreSupervision } = await import('../core/portfolio-supervision')
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createUser } = await import('../modules/identities')
	const { buildSelectionCookie } = await import('../modules/selection-cookie')
	const { sessionCookieName, createSession } = await import('../modules/sessions')
	const { createPortfolioForWorkspace } = await import('../modules/portfolio-creation')
	const { createWorkspaceForUser } = await import('../modules/workspace-creation')
	const { createServerApiContext } = await import('./context')

	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness('gorchestra-server-portfolio-context-')
	const now = new Date('2026-06-21T00:00:00.000Z')
	const fixtureUserId = '01k00000000000000000000031'
	const fixtureSessionId = '01k00000000000000000000032'
	const fixtureWorkspaceId = '01k00000000000000000000033'
	const fixtureWorkspaceMemberId = '01k00000000000000000000034'
	const fixturePortfolioId = '01k00000000000000000000035'
	const fixtureWorkspaceOwnerRoleId = '01k00000000000000000000036'
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

				expect(result.projects).toEqual({
					ok: true,
					value: {
						items: [],
						pages: { current: 1, start: 1, last: 1, previous: null, next: null },
						docs: { limit: 0, total: 0, count: 0 },
					},
				})
				expect(result.selectedContext.session).toEqual(session.session)
				expect(result.selectedContext.workspace).toEqual(provisioned.workspace)
				expect(result.selectedContext.workspaceMember).toEqual(provisioned.workspaceMember)
				expect(result.selectedContext.portfolio).toEqual(provisioned.portfolio)
				expect(result.selectedContext.activeWorkspaceOwnerRole).toEqual(provisioned.workspaceOwnerRole)
			})
		})

		it('maps an authorized unavailable Portfolio Core Runtime to Service Unavailable', async () => {
			await withPortfolioContextFixture(async ({ apiContext, cookies, portfolioCores }) => {
				await portfolioCores.close()

				await expect(withSelectedPortfolioCore(apiContext, cookies, () => Promise.resolve(null))).rejects.toMatchObject({
					statusCode: 503,
					message: 'Selected Portfolio is temporarily unavailable',
				})
			})
		})

		it('maps missing selected Portfolio context to Precondition Required before borrowing Core', async () => {
			await withPortfolioContextFixture(async ({ apiContext, cookies, portfolioCores }) => {
				const { [selectionCookieName]: _selectionToken, ...cookiesWithoutSelection } = cookies
				const borrow = vi.spyOn(portfolioCores, 'borrow')

				await expect(
					withSelectedPortfolioCore(apiContext, cookiesWithoutSelection, () => Promise.resolve(null)),
				).rejects.toBeInstanceOf(PreconditionRequiredError)
				expect(borrow).not.toHaveBeenCalled()
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
				userId: fixtureUserId,
				email: 'person@example.com',
				sessionId: fixtureSessionId,
				issuedAt: now.toISOString(),
				expiresAt: now.toISOString(),
			},
			selection: {
				workspaceId: fixtureWorkspaceId,
				portfolioId: fixturePortfolioId,
				issuedAt: now.toISOString(),
				expiresAt: now.toISOString(),
			},
			workspace: { id: fixtureWorkspaceId, displayName: 'Workspace', createdAt: now.toISOString() },
			workspaceMember: {
				id: fixtureWorkspaceMemberId,
				workspaceId: fixtureWorkspaceId,
				userId: fixtureUserId,
				membershipStartedAt: now.toISOString(),
				membershipEndedAt: null,
			},
			portfolio: {
				id: fixturePortfolioId,
				workspaceId: fixtureWorkspaceId,
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
			id: fixtureWorkspaceOwnerRoleId,
			workspaceId: fixtureWorkspaceId,
			workspaceMemberId: fixtureWorkspaceMemberId,
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
			await fixture.portfolioCores.close()
			await fixture.serverStorage.close()
		}
	}

	async function createPortfolioContextFixture() {
		const dataDir = await createTempServerDataDir()
		const serverStorage = await openServerStorage({ dataDir })
		const serverCache = createTestServerCache()
		const corePortfolioStorage = { type: 'json' as const, dataDir }
		const user = await createUser({ serverStorage, now })
		const session = await createSession({
			serverCache,
			userId: user.id,
			email: 'person@example.com',
			now,
			signingKey: sessionSigningKey,
			generateSessionId: () => fixtureSessionId,
		})
		const createdWorkspace = await createWorkspaceForUser({ serverStorage, userId: user.id, displayName: 'Workspace', now })
		const portfolio = await createPortfolioForWorkspace({
			serverStorage,
			workspaceId: createdWorkspace.workspace.id,
			displayName: 'Portfolio',
			corePortfolioStorage,
			now,
			secretEncryptionKey,
			portfolioRegistered: () => {},
			coreStorageNamespaceFactory: () => `portfolios/${crypto.randomUUID()}`,
		})
		const provisioned = { ...createdWorkspace, portfolio }
		const portfolioCores = createPortfolioCoreSupervision({
			serverStorage,
			corePortfolioStorage,
			secretEncryptionKey,
			config: defaultPortfolioCoreSupervisionConfig,
			processor: { ...defaultDispatchProcessorOptions },
			publishNotification: () => {},
		})
		await portfolioCores.start()
		const apiContext = createServerApiContext({
			serverStorage,
			serverCache,
			corePortfolioStorage,
			security: {
				sessionSigningKey,
				selectionSigningKey,
				secretEncryptionKey,
			},
			portfolioCores,
			now: () => now,
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
			portfolioCores,
			user,
			session,
			provisioned,
			cookies: { [sessionCookieName]: session.token, [selectionCookieName]: selection.token },
		}
	}
}
