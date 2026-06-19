import axios, { type AxiosError } from 'axios'

type ServerSession = {
	userId: string
	email: string
	sessionId: string
	issuedAt: string
	expiresAt: string
}

type Workspace = {
	id: string
	displayName: string
	createdAt: string
}

type WorkspaceMember = {
	id: string
	workspaceId: string
	userId: string
	membershipStartedAt: string
	membershipEndedAt: string | null
}

type WorkspaceOwnerRole = {
	id: string
	workspaceId: string
	workspaceMemberId: string
	assignedAt: string
	revokedAt: string | null
}

type PortfolioRegistryEntry = {
	id: string
	workspaceId: string
	displayName: string
	coreStorageNamespace: string
	registeredAt: string
}

type SelectedPortfolio = {
	workspaceId: string
	portfolioId: string
	issuedAt: string
	expiresAt: string
}

type AccessibleWorkspacePortfolio = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	portfolio: PortfolioRegistryEntry
	activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
}

type SessionStatusResponse =
	| { authenticated: true; session: ServerSession; tokenStatus: 'current' | 'previous-grace'; refreshRecommended: boolean }
	| { authenticated: false; reason: 'missing-token' | 'invalid-token' | 'expired' | 'not-current' }

type EmailOtpChallengeResponse = { requested: true }

type EmailOtpSignInResponse = {
	signedIn: true
	user: { id: string; createdAt: string }
	emailAuthenticationIdentity: { id: string; userId: string; email: string; createdAt: string }
	createdUser: boolean
	session: ServerSession
}

type RefreshedSessionResponse = { refreshed: true; session: ServerSession }

type SignedOutResponse = { signedOut: true }

type WorkspacePortfoliosResponse = { workspacePortfolios: AccessibleWorkspacePortfolio[] }

type ProvisionedWorkspaceResponse = {
	provisioned: true
	workspace: Workspace
	workspaceMember: WorkspaceMember
	workspaceOwnerRole: WorkspaceOwnerRole
	portfolio: PortfolioRegistryEntry
	selection: SelectedPortfolio
}

type SelectionAccessResponse =
	| {
			selected: true
			selection: SelectedPortfolio
			workspace: Workspace
			workspaceMember: WorkspaceMember
			portfolio: PortfolioRegistryEntry
			activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
	  }
	| {
			selected: false
			reason:
				| 'missing-token'
				| 'invalid-token'
				| 'expired'
				| 'user-not-found'
				| 'workspace-not-found'
				| 'not-active-member'
				| 'portfolio-not-found'
	  }

type SelectionClearedResponse = { selected: false; reason: 'cleared' }

const client = axios.create({ baseURL: '/api', withCredentials: true })

export function useServerApi() {
	return {
		async requestEmailOtp(email: string): Promise<EmailOtpChallengeResponse> {
			return getResponseData(await client.post<EmailOtpChallengeResponse>('/auth/email-otp/challenges', { email }))
		},
		async verifyEmailOtpSignIn(email: string, code: string): Promise<EmailOtpSignInResponse> {
			return getResponseData(await client.post<EmailOtpSignInResponse>('/auth/email-otp/sign-in', { email, code }))
		},
		async getSession(): Promise<SessionStatusResponse> {
			return getResponseData(await client.get<SessionStatusResponse>('/auth/session'))
		},
		async refreshSession(): Promise<RefreshedSessionResponse> {
			return getResponseData(await client.post<RefreshedSessionResponse>('/auth/refresh'))
		},
		async logout(): Promise<SignedOutResponse> {
			return getResponseData(await client.delete<SignedOutResponse>('/auth/session'))
		},
		async listWorkspacePortfolios(): Promise<WorkspacePortfoliosResponse> {
			return getResponseData(await client.get<WorkspacePortfoliosResponse>('/workspaces/portfolios'))
		},
		async provisionDefaultWorkspace(input: {
			workspaceDisplayName: string
			portfolioDisplayName: string
		}): Promise<ProvisionedWorkspaceResponse> {
			return getResponseData(await client.post<ProvisionedWorkspaceResponse>('/workspaces/provision-default', input))
		},
		async getSelection(): Promise<SelectionAccessResponse> {
			return getResponseData(await client.get<SelectionAccessResponse>('/selection'))
		},
		async setSelection(workspaceId: string, portfolioId: string): Promise<SelectionAccessResponse> {
			return getResponseData(await client.post<SelectionAccessResponse>('/selection', { workspaceId, portfolioId }))
		},
		async clearSelection(): Promise<SelectionClearedResponse> {
			return getResponseData(await client.delete<SelectionClearedResponse>('/selection/'))
		},
		errorMessage(error: unknown): string {
			return getErrorMessage(error)
		},
	}
}

function getResponseData<T>(response: { data: T }): T {
	return response.data
}

function getErrorMessage(error: unknown): string {
	return axios.isAxiosError(error) ? getAxiosErrorMessage(error) : getUnknownErrorMessage(error)
}

function getAxiosErrorMessage(error: AxiosError<unknown>): string {
	return getApiErrorMessages(error.response?.data) ?? error.message
}

function getUnknownErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error'
}

function getApiErrorMessages(data: unknown): string | null {
	return Array.isArray(data) ? data.map(getApiErrorMessage).join('\n') : null
}

function getApiErrorMessage(error: unknown): string {
	return hasMessage(error) ? String(error.message) : String(error)
}

function hasMessage(error: unknown): error is { message: unknown } {
	return typeof error === 'object' && error !== null && 'message' in error
}
