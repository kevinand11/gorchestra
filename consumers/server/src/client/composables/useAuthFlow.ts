import { useServerApi } from './useServerApi'
import type { SelectionAccessResponse, SessionStatusResponse, WorkspacePortfoliosResponse } from '../../shared/api'

export type AuthFlowState = {
	session: SessionStatusResponse
	workspacePortfolios: WorkspacePortfoliosResponse['workspacePortfolios']
	selection: SelectionAccessResponse | null
}

export type ServerApiForAuthFlow = Pick<ReturnType<typeof useServerApi>, 'getSession' | 'getSelection' | 'listWorkspacePortfolios'>

const routeRedirects: Record<string, (state: AuthFlowState) => string | null> = {
	'/': redirectFromIndex,
	'/sign-in': redirectFromSignIn,
	'/select': redirectFromSelect,
	'/app': redirectFromApp,
}

export async function loadAuthFlowState(api: ServerApiForAuthFlow = useServerApi()): Promise<AuthFlowState> {
	const session = await api.getSession()
	if (!session.authenticated) return { session, workspacePortfolios: [], selection: null }

	const [workspacePortfolios, selection] = await Promise.all([api.listWorkspacePortfolios(), api.getSelection()])
	return { session, workspacePortfolios: workspacePortfolios.workspacePortfolios, selection }
}

export function redirectForAuthFlowRoute(path: string, state: AuthFlowState): string | null {
	return routeRedirects[path]?.(state) ?? null
}

function redirectFromIndex(state: AuthFlowState): string {
	return state.session.authenticated ? authHomePath(state) : '/sign-in'
}

function redirectFromSignIn(state: AuthFlowState): string | null {
	return state.session.authenticated ? authHomePath(state) : null
}

function redirectFromSelect(state: AuthFlowState): string | null {
	return state.session.authenticated ? null : '/sign-in'
}

function redirectFromApp(state: AuthFlowState): string | null {
	if (!state.session.authenticated) return '/sign-in'
	return state.selection?.selected ? null : '/select'
}

function authHomePath(state: AuthFlowState): '/app' | '/select' {
	return state.selection?.selected ? '/app' : '/select'
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const unauthenticated: AuthFlowState = {
		session: { authenticated: false, reason: 'missing-token' },
		workspacePortfolios: [],
		selection: null,
	}
	const authenticatedWithoutSelection: AuthFlowState = {
		session: {
			authenticated: true,
			tokenStatus: 'current',
			refreshRecommended: false,
			session: {
				userId: 'user-1',
				email: 'person@example.com',
				sessionId: 'session-1',
				issuedAt: '2026-06-19T00:00:00.000Z',
				expiresAt: '2026-06-20T00:00:00.000Z',
			},
		},
		workspacePortfolios: [],
		selection: { selected: false, reason: 'missing-token' },
	}
	const authenticatedWithSelection: AuthFlowState = {
		...authenticatedWithoutSelection,
		selection: {
			selected: true,
			selection: {
				workspaceId: 'workspace-1',
				portfolioId: 'portfolio-1',
				issuedAt: '2026-06-19T00:00:00.000Z',
				expiresAt: '2026-06-20T00:00:00.000Z',
			},
			workspace: { id: 'workspace-1', displayName: 'Workspace', createdAt: '2026-06-19T00:00:00.000Z' },
			workspaceMember: {
				id: 'member-1',
				workspaceId: 'workspace-1',
				userId: 'user-1',
				membershipStartedAt: '2026-06-19T00:00:00.000Z',
				membershipEndedAt: null,
			},
			portfolio: {
				id: 'portfolio-1',
				workspaceId: 'workspace-1',
				displayName: 'Portfolio',
				coreStorageNamespace: 'portfolios/test',
				registeredAt: '2026-06-19T00:00:00.000Z',
			},
			activeWorkspaceOwnerRole: null,
		},
	}

	describe('auth-flow redirects', () => {
		it('sends unauthenticated managed routes to sign-in except sign-in itself', () => {
			expect(redirectForAuthFlowRoute('/app', unauthenticated)).toBe('/sign-in')
			expect(redirectForAuthFlowRoute('/select', unauthenticated)).toBe('/sign-in')
			expect(redirectForAuthFlowRoute('/sign-in', unauthenticated)).toBeNull()
		})

		it('sends authenticated users without selection to selection routes', () => {
			expect(redirectForAuthFlowRoute('/', authenticatedWithoutSelection)).toBe('/select')
			expect(redirectForAuthFlowRoute('/sign-in', authenticatedWithoutSelection)).toBe('/select')
			expect(redirectForAuthFlowRoute('/app', authenticatedWithoutSelection)).toBe('/select')
			expect(redirectForAuthFlowRoute('/select', authenticatedWithoutSelection)).toBeNull()
		})

		it('sends authenticated users with selection to app while allowing selection changes', () => {
			expect(redirectForAuthFlowRoute('/', authenticatedWithSelection)).toBe('/app')
			expect(redirectForAuthFlowRoute('/sign-in', authenticatedWithSelection)).toBe('/app')
			expect(redirectForAuthFlowRoute('/app', authenticatedWithSelection)).toBeNull()
			expect(redirectForAuthFlowRoute('/select', authenticatedWithSelection)).toBeNull()
		})
	})
}
