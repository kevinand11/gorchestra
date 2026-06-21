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
type PreconditionRequiredHandler = () => void | Promise<void>

const preconditionRequiredStatusCode = 428

let serverApiOptionsResolver: ServerApiOptionsResolver | null = null
let preconditionRequiredHandler: PreconditionRequiredHandler | null = null

export function setServerApiOptionsResolver(resolver: ServerApiOptionsResolver): void {
	serverApiOptionsResolver = resolver
}

export function setPreconditionRequiredHandler(handler: PreconditionRequiredHandler): void {
	preconditionRequiredHandler = handler
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
	client.interceptors.response.use(
		(response) => response,
		async (error: unknown) => {
			if (shouldHandlePreconditionRequired(error)) await preconditionRequiredHandler?.()
			throw error
		},
	)

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

function shouldHandlePreconditionRequired(error: unknown): boolean {
	return typeof window !== 'undefined' && getHttpStatusCode(error) === preconditionRequiredStatusCode
}

function getHttpStatusCode(error: unknown): number | null {
	const status = getNestedValue(error, ['response', 'status'])
	return typeof status === 'number' ? status : null
}

function getNestedValue(source: unknown, path: string[]): unknown {
	return path.reduce<unknown>((value, key) => {
		if (typeof value !== 'object' || value === null || !(key in value)) return undefined
		return value[key as keyof typeof value]
	}, source)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server API precondition handling', () => {
		it('extracts Axios HTTP status codes', () => {
			expect(getHttpStatusCode({ response: { status: 428 } })).toBe(428)
			expect(getHttpStatusCode({ response: { status: '428' } })).toBeNull()
			expect(getHttpStatusCode(new Error('network'))).toBeNull()
		})
	})
}
