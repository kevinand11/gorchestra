import { defineStore } from 'pinia'

import type {
	EmailOtpChallengeResponse,
	EmailOtpSignInResponse,
	ProvisionedWorkspaceResponse,
	SelectionAccessResponse,
	SelectionClearedResponse,
	SessionStatusResponse,
	SignedOutResponse,
	WorkspacePortfoliosResponse,
} from '../../shared/api'
import { useServerApi, type ServerApi } from '../composables/useServerApi'

export type ClientSelectionState = SelectionAccessResponse | SelectionClearedResponse

export type SessionStoreState = {
	session: SessionStatusResponse | null
	workspacePortfolios: WorkspacePortfoliosResponse['workspacePortfolios']
	selection: ClientSelectionState | null
}

type ProvisionDefaultWorkspaceInput = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

function getSessionHomePath(state: Pick<SessionStoreState, 'session' | 'selection'>): '/sign-in' | '/select' | '/app' {
	if (!isAuthenticatedSession(state.session)) return '/sign-in'
	return isSelectedPortfolio(state.selection) ? '/app' : '/select'
}

function isAuthenticatedSession(session: SessionStatusResponse | null): boolean {
	return session?.authenticated === true
}

function isSelectedPortfolio(selection: ClientSelectionState | null): boolean {
	return selection?.selected === true
}

export const useSessionStore = defineStore('session', {
	state: (): SessionStoreState => ({ session: null, workspacePortfolios: [], selection: null }),
	getters: {
		isAuthenticated: (state): boolean => state.session?.authenticated === true,
		hasSelection: (state): boolean => state.selection?.selected === true,
		homePath: (state): '/sign-in' | '/select' | '/app' => getSessionHomePath(state),
	},
	actions: {
		async loadSession(api: ServerApi = useServerApi()): Promise<SessionStatusResponse> {
			const session = await api.getSession()
			this.session = session
			if (!session.authenticated) this.clearAuthenticatedState()
			return session
		},
		async loadAuthenticatedState(api: ServerApi = useServerApi()): Promise<void> {
			const session = await this.loadSession(api)
			if (!session.authenticated) return

			const [workspacePortfolios, selection] = await Promise.all([api.listWorkspacePortfolios(), api.getSelection()])
			this.workspacePortfolios = workspacePortfolios.workspacePortfolios
			this.selection = selection
		},
		async loadSelection(api: ServerApi = useServerApi()): Promise<SelectionAccessResponse | null> {
			if (!this.isAuthenticated) return null
			this.selection = await api.getSelection()
			return this.selection
		},
		async requestEmailOtp(email: string, api: ServerApi = useServerApi()): Promise<EmailOtpChallengeResponse> {
			return await api.requestEmailOtp(email)
		},
		async verifyEmailOtpSignIn(email: string, code: string, api: ServerApi = useServerApi()): Promise<EmailOtpSignInResponse> {
			const response = await api.verifyEmailOtpSignIn(email, code)
			await this.loadAuthenticatedState(api)
			return response
		},
		async provisionDefaultWorkspace(
			input: ProvisionDefaultWorkspaceInput,
			api: ServerApi = useServerApi(),
		): Promise<ProvisionedWorkspaceResponse> {
			const response = await api.provisionDefaultWorkspace(input)
			this.workspacePortfolios = [
				{
					workspace: response.workspace,
					workspaceMember: response.workspaceMember,
					portfolio: response.portfolio,
					activeWorkspaceOwnerRole: response.workspaceOwnerRole,
				},
			]
			this.selection = {
				selected: true,
				selection: response.selection,
				workspace: response.workspace,
				workspaceMember: response.workspaceMember,
				portfolio: response.portfolio,
				activeWorkspaceOwnerRole: response.workspaceOwnerRole,
			}
			return response
		},
		async setSelection(workspaceId: string, portfolioId: string, api: ServerApi = useServerApi()): Promise<SelectionAccessResponse> {
			this.selection = await api.setSelection(workspaceId, portfolioId)
			return this.selection
		},
		async clearSelection(api: ServerApi = useServerApi()): Promise<SelectionClearedResponse> {
			const response = await api.clearSelection()
			this.selection = response
			return response
		},
		async logout(api: ServerApi = useServerApi()): Promise<SignedOutResponse> {
			const response = await api.logout()
			this.session = { authenticated: false, reason: 'missing-token' }
			this.clearAuthenticatedState()
			return response
		},
		errorMessage(error: unknown): string {
			return useServerApi().errorMessage(error)
		},
		clearAuthenticatedState(): void {
			this.workspacePortfolios = []
			this.selection = null
		},
	},
})

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('session home path', () => {
		it('uses sign-in for missing or unauthenticated sessions', () => {
			expect(getSessionHomePath({ session: null, selection: null })).toBe('/sign-in')
			expect(getSessionHomePath({ session: { authenticated: false, reason: 'missing-token' }, selection: null })).toBe('/sign-in')
		})

		it('uses select for authenticated sessions without valid selection', () => {
			expect(getSessionHomePath({ session: authenticatedSession(), selection: null })).toBe('/select')
			expect(getSessionHomePath({ session: authenticatedSession(), selection: { selected: false, reason: 'missing-token' } })).toBe(
				'/select',
			)
		})

		it('uses app for authenticated sessions with valid selection', () => {
			expect(getSessionHomePath({ session: authenticatedSession(), selection: selectedPortfolio() })).toBe('/app')
		})
	})

	function authenticatedSession(): SessionStatusResponse {
		return {
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
		}
	}

	function selectedPortfolio(): ClientSelectionState {
		return {
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
		}
	}
}
