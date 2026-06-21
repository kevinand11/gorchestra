export type ServerSession = {
	userId: string
	email: string
	sessionId: string
	issuedAt: string
	expiresAt: string
}

export type ServerUser = {
	id: string
	createdAt: string
}

export type EmailAuthenticationIdentity = {
	id: string
	userId: string
	email: string
	createdAt: string
}

export type Workspace = {
	id: string
	displayName: string
	createdAt: string
}

export type WorkspaceMember = {
	id: string
	workspaceId: string
	userId: string
	membershipStartedAt: string
	membershipEndedAt: string | null
}

export type WorkspaceOwnerRole = {
	id: string
	workspaceId: string
	workspaceMemberId: string
	assignedAt: string
	revokedAt: string | null
}

export type PortfolioRegistryEntry = {
	id: string
	workspaceId: string
	displayName: string
	coreStorageNamespace: string
	registeredAt: string
}

export type SelectedPortfolio = {
	workspaceId: string
	portfolioId: string
	issuedAt: string
	expiresAt: string
}

export type AccessibleWorkspacePortfolio = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	portfolio: PortfolioRegistryEntry
	activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
}

export type SessionStatusResponse =
	| { authenticated: true; session: ServerSession; tokenStatus: 'current' | 'previous-grace'; refreshRecommended: boolean }
	| { authenticated: false; reason: 'missing-token' | 'invalid-token' | 'expired' | 'not-current' }

export type EmptyResponse = undefined

export type EmailOtpChallengeResponse = EmptyResponse

export type EmailOtpSignInResponse = {
	user: ServerUser
	emailAuthenticationIdentity: EmailAuthenticationIdentity
	createdUser: boolean
	session: ServerSession
}

export type RefreshedSessionResponse = ServerSession

export type SignedOutResponse = EmptyResponse

export type WorkspacePortfoliosResponse = AccessibleWorkspacePortfolio[]

export type ProvisionedWorkspaceResponse = {
	workspace: Workspace
	workspaceMember: WorkspaceMember
	workspaceOwnerRole: WorkspaceOwnerRole
	portfolio: PortfolioRegistryEntry
	selection: SelectedPortfolio
}

export type SelectionAccessFailureReason =
	| 'missing-token'
	| 'invalid-token'
	| 'expired'
	| 'user-not-found'
	| 'workspace-not-found'
	| 'not-active-member'
	| 'portfolio-not-found'

export type SelectionAccessResponse =
	| {
			selected: true
			selection: SelectedPortfolio
			workspace: Workspace
			workspaceMember: WorkspaceMember
			portfolio: PortfolioRegistryEntry
			activeWorkspaceOwnerRole: WorkspaceOwnerRole | null
	  }
	| { selected: false; reason: SelectionAccessFailureReason }

export type SelectionClearedResponse = EmptyResponse
