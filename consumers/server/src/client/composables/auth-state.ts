import { useFetchAction } from './action-state'
import { useQueryCache } from './query-cache'
import { useServerApi, type ServerApi } from './useServerApi'

type SessionStatus = Awaited<ReturnType<ServerApi['getSession']>>
type AuthenticatedSessionStatus = Extract<SessionStatus, { authenticated: true }>
type SelectionAccess = Awaited<ReturnType<ServerApi['getSelection']>>
type SelectedPortfolioAccess = Extract<SelectionAccess, { selected: true }>
type EmailOtpSignInResponse = Awaited<ReturnType<ServerApi['verifyEmailOtpSignIn']>>
type ProvisionDefaultWorkspaceResponse = Awaited<ReturnType<ServerApi['provisionDefaultWorkspace']>>

type ProvisionDefaultWorkspaceInput = {
	workspaceDisplayName: string
	portfolioDisplayName: string
}

export function useAuthState() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache

	async function getSession(): Promise<SessionStatus> {
		return await queryCache.read(queryKeys.session(), unauthenticatedSession(), () => serverApi.getSession())
	}

	async function getSelection(): Promise<SelectionAccess> {
		return await queryCache.read(queryKeys.selection(), unselectedPortfolio(), () => serverApi.getSelection())
	}

	async function getHomePath(): Promise<'/sign-in' | '/select' | '/projects'> {
		const session = await getSession()
		if (!isAuthenticatedSession(session)) return '/sign-in'
		const selection = await getSelection()
		return isSelectedPortfolio(selection) ? '/projects' : '/select'
	}

	async function requestEmailOtp(email: string) {
		return await serverApi.requestEmailOtp(email)
	}

	async function verifyEmailOtpSignIn(email: string, code: string): Promise<EmailOtpSignInResponse> {
		const response = await serverApi.verifyEmailOtpSignIn(email, code)
		queryCache.clear([])
		queryCache.set(queryKeys.session(), authenticatedSessionFromSignIn(response))
		queryCache.set(queryKeys.selection(), unselectedPortfolio())
		return response
	}

	async function provisionDefaultWorkspace(input: ProvisionDefaultWorkspaceInput): Promise<ProvisionDefaultWorkspaceResponse> {
		const response = await serverApi.provisionDefaultWorkspace(input)
		queryCache.clear(['portfolio'])
		queryCache.invalidate(queryKeys.workspacePortfolios())
		queryCache.set(queryKeys.selection(), selectionFromProvisioning(response))
		return response
	}

	async function setSelection(workspaceId: string, portfolioId: string): Promise<SelectionAccess> {
		const selection = await serverApi.setSelection(workspaceId, portfolioId)
		queryCache.clear(['portfolio'])
		queryCache.set(queryKeys.selection(), selection)
		return selection
	}

	async function clearSelection(): Promise<void> {
		await serverApi.clearSelection()
		queryCache.clear(['portfolio'])
		queryCache.set(queryKeys.selection(), unselectedPortfolio())
	}

	async function logout(): Promise<void> {
		await serverApi.logout()
		queryCache.clear([])
		await navigateTo('/sign-in')
	}

	return {
		getSession,
		getSelection,
		getHomePath,
		requestEmailOtp,
		verifyEmailOtpSignIn,
		provisionDefaultWorkspace,
		setSelection,
		clearSelection,
		logout,
	}
}

export function useSessionStatus(options: { immediate?: boolean } = {}) {
	const serverApi = useServerApi()
	const { queryKeys } = useQueryCache()
	return useFetchAction(() => serverApi.getSession(), {
		queryKey: queryKeys.session(),
		initialData: unauthenticatedSession(),
		immediate: options.immediate ?? false,
	})
}

export function useSelectionAccess(options: { immediate?: boolean } = {}) {
	const serverApi = useServerApi()
	const { queryKeys } = useQueryCache()
	return useFetchAction(() => serverApi.getSelection(), {
		queryKey: queryKeys.selection(),
		initialData: unselectedPortfolio(),
		immediate: options.immediate ?? false,
	})
}

export function isAuthenticatedSession(session: SessionStatus): session is AuthenticatedSessionStatus {
	return session.authenticated
}

export function isSelectedPortfolio(selection: SelectionAccess): selection is SelectedPortfolioAccess {
	return selection.selected
}

export function unauthenticatedSession(): SessionStatus {
	return { authenticated: false, reason: 'missing-token' }
}

export function unselectedPortfolio(): SelectionAccess {
	return { selected: false, reason: 'missing-token' }
}

function authenticatedSessionFromSignIn(response: EmailOtpSignInResponse): AuthenticatedSessionStatus {
	return { authenticated: true, session: response.session, tokenStatus: 'current', refreshRecommended: false }
}

function selectionFromProvisioning(response: ProvisionDefaultWorkspaceResponse): SelectedPortfolioAccess {
	return {
		selected: true,
		selection: response.selection,
		workspace: response.workspace,
		workspaceMember: response.workspaceMember,
		portfolio: response.portfolio,
		activeWorkspaceOwnerRole: response.workspaceOwnerRole,
	}
}

export function getSessionHomePath(state: { session: SessionStatus; selection: SelectionAccess }): '/sign-in' | '/select' | '/projects' {
	if (!isAuthenticatedSession(state.session)) return '/sign-in'
	return isSelectedPortfolio(state.selection) ? '/projects' : '/select'
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('session home path', () => {
		it('uses sign-in for unauthenticated sessions', () => {
			expect(getSessionHomePath({ session: unauthenticatedSession(), selection: unselectedPortfolio() })).toBe('/sign-in')
		})

		it('uses select for authenticated sessions without valid selection', () => {
			expect(getSessionHomePath({ session: authenticatedSession(), selection: unselectedPortfolio() })).toBe('/select')
		})

		it('uses Projects for authenticated sessions with valid selection', () => {
			expect(getSessionHomePath({ session: authenticatedSession(), selection: selectedPortfolio() })).toBe('/projects')
		})
	})

	function authenticatedSession(): SessionStatus {
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

	function selectedPortfolio(): SelectionAccess {
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
				coreStorageNamespace: 'portfolios/portfolio-1',
				registeredAt: '2026-06-19T00:00:00.000Z',
			},
			activeWorkspaceOwnerRole: null,
		}
	}
}
