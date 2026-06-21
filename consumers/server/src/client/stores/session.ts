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

export const useSessionStore = defineStore('session', () => {
	const session = ref<SessionStatusResponse | null>(null)
	const workspacePortfolios = ref<WorkspacePortfoliosResponse['workspacePortfolios']>([])
	const selection = ref<ClientSelectionState | null>(null)

	const isAuthenticated = computed((): boolean => isAuthenticatedSession(session.value))
	const hasSelection = computed((): boolean => isSelectedPortfolio(selection.value))
	const homePath = computed((): '/sign-in' | '/select' | '/app' =>
		getSessionHomePath({ session: session.value, selection: selection.value }),
	)

	async function loadSession(api: ServerApi = useServerApi()): Promise<SessionStatusResponse> {
		const response = await api.getSession()
		session.value = response
		if (!response.authenticated) clearAuthenticatedState()
		return response
	}

	async function loadAuthenticatedState(api: ServerApi = useServerApi()): Promise<void> {
		const response = await loadSession(api)
		if (!response.authenticated) return

		const [workspacePortfoliosResponse, selectionResponse] = await Promise.all([api.listWorkspacePortfolios(), api.getSelection()])
		workspacePortfolios.value = workspacePortfoliosResponse.workspacePortfolios
		selection.value = selectionResponse
	}

	async function loadSelection(api: ServerApi = useServerApi()): Promise<SelectionAccessResponse | null> {
		if (!isAuthenticated.value) return null
		selection.value = await api.getSelection()
		return selection.value
	}

	async function requestEmailOtp(email: string, api: ServerApi = useServerApi()): Promise<EmailOtpChallengeResponse> {
		return await api.requestEmailOtp(email)
	}

	async function verifyEmailOtpSignIn(email: string, code: string, api: ServerApi = useServerApi()): Promise<EmailOtpSignInResponse> {
		const response = await api.verifyEmailOtpSignIn(email, code)
		await loadAuthenticatedState(api)
		return response
	}

	async function provisionDefaultWorkspace(
		input: ProvisionDefaultWorkspaceInput,
		api: ServerApi = useServerApi(),
	): Promise<ProvisionedWorkspaceResponse> {
		const response = await api.provisionDefaultWorkspace(input)
		workspacePortfolios.value = [
			{
				workspace: response.workspace,
				workspaceMember: response.workspaceMember,
				portfolio: response.portfolio,
				activeWorkspaceOwnerRole: response.workspaceOwnerRole,
			},
		]
		selection.value = {
			selected: true,
			selection: response.selection,
			workspace: response.workspace,
			workspaceMember: response.workspaceMember,
			portfolio: response.portfolio,
			activeWorkspaceOwnerRole: response.workspaceOwnerRole,
		}
		return response
	}

	async function setSelection(
		workspaceId: string,
		portfolioId: string,
		api: ServerApi = useServerApi(),
	): Promise<SelectionAccessResponse> {
		selection.value = await api.setSelection(workspaceId, portfolioId)
		return selection.value
	}

	async function clearSelection(api: ServerApi = useServerApi()): Promise<SelectionClearedResponse> {
		const response = await api.clearSelection()
		selection.value = response
		return response
	}

	async function logout(api: ServerApi = useServerApi()): Promise<SignedOutResponse> {
		const response = await api.logout()
		session.value = { authenticated: false, reason: 'missing-token' }
		clearAuthenticatedState()
		return response
	}

	function errorMessage(error: unknown): string {
		return useServerApi().errorMessage(error)
	}

	function clearAuthenticatedState(): void {
		workspacePortfolios.value = []
		selection.value = null
	}

	return {
		session,
		workspacePortfolios,
		selection,
		isAuthenticated,
		hasSelection,
		homePath,
		loadSession,
		loadAuthenticatedState,
		loadSelection,
		requestEmailOtp,
		verifyEmailOtpSignIn,
		provisionDefaultWorkspace,
		setSelection,
		clearSelection,
		logout,
		errorMessage,
		clearAuthenticatedState,
	}
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
