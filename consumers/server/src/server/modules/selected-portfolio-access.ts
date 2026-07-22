import type { ServerCache } from '../cache'
import { resolveSelectionAccess, type SelectionAccessFailureReason, type SelectionAccessResult } from './selection-access'
import { verifySessionToken, type ServerSession, type VerifySessionTokenResult } from './sessions'
import type { ServerStorage } from '../storage/repo'

type ResolveSelectedPortfolioAccessInput = {
	serverStorage: ServerStorage
	serverCache: ServerCache
	sessionToken?: string | null
	selectionToken?: string | null
	now: Date
	sessionSigningKey: string
	selectionSigningKey: string
}

export type ResolveSelectedPortfolioAccessResult =
	| {
			resolved: true
			session: ServerSession
			access: Extract<SelectionAccessResult, { selected: true }>
	  }
	| {
			resolved: false
			source: 'session'
			reason: Extract<VerifySessionTokenResult, { authenticated: false }>['reason']
	  }
	| {
			resolved: false
			source: 'selection'
			reason: SelectionAccessFailureReason
	  }

export async function resolveSelectedPortfolioAccess(
	input: ResolveSelectedPortfolioAccessInput,
): Promise<ResolveSelectedPortfolioAccessResult> {
	const authentication = await verifySessionToken({
		serverCache: input.serverCache,
		token: input.sessionToken,
		now: input.now,
		signingKey: input.sessionSigningKey,
	})
	if (!authentication.authenticated) return { resolved: false, source: 'session', reason: authentication.reason }

	const access = await resolveSelectionAccess({
		serverStorage: input.serverStorage,
		userId: authentication.session.userId,
		selectionToken: input.selectionToken,
		now: input.now,
		signingKey: input.selectionSigningKey,
	})
	if (!access.selected) return { resolved: false, source: 'selection', reason: access.reason }
	return { resolved: true, session: authentication.session, access }
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { createTestServerCache } = await import('../testing/server-cache')
	const { createTempServerStorageTestHarness } = await import('../testing/server-storage')
	const { openServerStorage } = await import('../storage/repo')
	const { createServerId } = await import('../server-id')
	const { createUser } = await import('./identities')
	const { createWorkspaceForUser } = await import('./workspace-creation')
	const { createPortfolioRegistryEntry } = await import('./workspaces')
	const { createSession } = await import('./sessions')
	const { buildSelectionCookie } = await import('./selection-cookie')

	const now = new Date('2026-07-21T22:30:00.000Z')
	const sessionSigningKey = 'selected-access-session-key'
	const selectionSigningKey = 'selected-access-selection-key'
	const { cleanupTempServerStorage, createTempServerDataDir } = createTempServerStorageTestHarness(
		'gorchestra-selected-portfolio-access-',
	)

	afterEach(cleanupTempServerStorage)

	describe('Selected Portfolio access', () => {
		it('resolves current Session and selected Portfolio access through Server-owned facts', async () => {
			await withSelectedAccessFixture(async ({ input, session, selection, workspace, portfolio }) => {
				expect(await resolveSelectedPortfolioAccess(input)).toEqual({
					resolved: true,
					session: session.session,
					access: {
						selected: true,
						selection: selection.selection,
						workspace: workspace.workspace,
						workspaceMember: workspace.workspaceMember,
						portfolio,
						activeWorkspaceOwnerRole: workspace.workspaceOwnerRole,
					},
				})
			})
		})

		it('rejects a missing Session before resolving Selection access', async () => {
			await withSelectedAccessFixture(async ({ input }) => {
				expect(await resolveSelectedPortfolioAccess({ ...input, sessionToken: null })).toEqual({
					resolved: false,
					source: 'session',
					reason: 'missing-token',
				})
			})
		})

		it('rejects missing Selection after authenticating the Session', async () => {
			await withSelectedAccessFixture(async ({ input }) => {
				expect(await resolveSelectedPortfolioAccess({ ...input, selectionToken: null })).toEqual({
					resolved: false,
					source: 'selection',
					reason: 'missing-token',
				})
			})
		})

		it('does not infer Portfolio access from signed Selection claims', async () => {
			await withSelectedAccessFixture(async ({ input, workspace }) => {
				const unregistered = buildSelectionCookie({
					workspaceId: workspace.workspace.id,
					portfolioId: createServerId(),
					now,
					signingKey: selectionSigningKey,
				})

				expect(await resolveSelectedPortfolioAccess({ ...input, selectionToken: unregistered.token })).toEqual({
					resolved: false,
					source: 'selection',
					reason: 'portfolio-not-found',
				})
			})
		})
	})

	async function withSelectedAccessFixture<T>(
		run: (fixture: Awaited<ReturnType<typeof createSelectedAccessFixture>>) => Promise<T>,
	): Promise<T> {
		const fixture = await createSelectedAccessFixture()
		try {
			return await run(fixture)
		} finally {
			await fixture.serverStorage.close()
		}
	}

	async function createSelectedAccessFixture() {
		const serverStorage = await openServerStorage({ dataDir: await createTempServerDataDir() })
		const serverCache = createTestServerCache()
		const user = await createUser({ serverStorage, now })
		const workspace = await createWorkspaceForUser({ serverStorage, userId: user.id, displayName: 'Workspace', now })
		const portfolio = await createPortfolioRegistryEntry({
			serverStorage,
			workspaceId: workspace.workspace.id,
			displayName: 'Portfolio',
			coreStorageNamespace: 'portfolios/selected-access',
			now,
		})
		const session = await createSession({
			serverCache,
			userId: user.id,
			email: 'person@example.com',
			now,
			signingKey: sessionSigningKey,
		})
		const selection = buildSelectionCookie({
			workspaceId: workspace.workspace.id,
			portfolioId: portfolio.id,
			now,
			signingKey: selectionSigningKey,
		})
		return {
			serverStorage,
			serverCache,
			user,
			workspace,
			portfolio,
			session,
			selection,
			input: {
				serverStorage,
				serverCache,
				sessionToken: session.token,
				selectionToken: selection.token,
				now,
				sessionSigningKey,
				selectionSigningKey,
			},
		}
	}
}
