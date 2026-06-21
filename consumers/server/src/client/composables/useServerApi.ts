import axios from 'axios'

import type {
	EmailOtpChallengeResponse,
	EmailOtpSignInResponse,
	ProvisionedWorkspaceResponse,
	RefreshedSessionResponse,
	SelectionAccessResponse,
	SelectionClearedResponse,
	SessionStatusResponse,
	SignedOutResponse,
	WorkspacePortfoliosResponse,
} from '../../shared/api'

export type ServerApiOptions = {
	baseURL?: string
	headers?: { cookie: string }
}

type ServerApiOptionsResolver = () => ServerApiOptions | null

let serverApiOptionsResolver: ServerApiOptionsResolver | null = null

export function setServerApiOptionsResolver(resolver: ServerApiOptionsResolver): void {
	serverApiOptionsResolver = resolver
}

export function useServerApi() {
	return createServerApi(resolveServerApiOptions())
}

function resolveServerApiOptions(): ServerApiOptions {
	if (typeof window !== 'undefined') return {}
	return resolveServerRequestApiOptions()
}

function resolveServerRequestApiOptions(): ServerApiOptions {
	if (serverApiOptionsResolver === null) return throwMissingServerApiContext()

	const options = serverApiOptionsResolver()
	if (options === null) return throwMissingServerApiContext()
	return options
}

function throwMissingServerApiContext(): never {
	throw new Error('Server API requests require an active Nuxt request context')
}

export function createServerApi(options: ServerApiOptions = {}) {
	const client = axios.create({
		baseURL: options.baseURL ?? '/api',
		withCredentials: true,
		...(options.headers === undefined ? {} : { headers: options.headers }),
	})

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
	}
}

export type ServerApi = ReturnType<typeof createServerApi>

function getResponseData<T>(response: { data: T }): T {
	return response.data
}
