import axios from 'axios'

import { createRouteContractAxiosClient } from '../utils/server-api-route-client'

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
	const routes = createRouteContractAxiosClient(client)

	return {
		async requestEmailOtp(email: string) {
			return routes.request('post', '/api/auth/email-otp/challenges', { body: { email } })
		},
		async verifyEmailOtpSignIn(email: string, code: string) {
			return routes.request('post', '/api/auth/email-otp/sign-in', { body: { email, code } })
		},
		async getSession() {
			return routes.request('get', '/api/auth/session')
		},
		async refreshSession() {
			return routes.request('post', '/api/auth/refresh')
		},
		async logout() {
			return routes.request('delete', '/api/auth/session')
		},
		async listWorkspacePortfolios() {
			return routes.request('get', '/api/workspaces/portfolios')
		},
		async listProjects() {
			return routes.request('get', '/api/portfolio/projects')
		},
		async createProject(input: { title: string }) {
			return routes.request('post', '/api/portfolio/projects', { body: input })
		},
		async getProject(projectId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId', { params: { projectId } })
		},
		async listRepositories(projectId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/repositories', { params: { projectId } })
		},
		async createRepository(
			projectId: string,
			input: { config: { provider: 'github'; owner: string; name: string; secretId: string } },
		) {
			return routes.request('post', '/api/portfolio/projects/:projectId/repositories', { params: { projectId }, body: input })
		},
		async getRepository(projectId: string, repositoryId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/repositories/:repositoryId', {
				params: { projectId, repositoryId },
			})
		},
		async preflightRepository(projectId: string, repositoryId: string) {
			return routes.request('post', '/api/portfolio/projects/:projectId/repositories/:repositoryId/preflight', {
				params: { projectId, repositoryId },
			})
		},
		async listSecrets() {
			return routes.request('get', '/api/portfolio/secrets')
		},
		async createSecret(input: { name: string; value: string }) {
			return routes.request('post', '/api/portfolio/secrets', { body: input })
		},
		async getSecret(secretId: string) {
			return routes.request('get', '/api/portfolio/secrets/:secretId', { params: { secretId } })
		},
		async provisionDefaultWorkspace(input: { workspaceDisplayName: string; portfolioDisplayName: string }) {
			return routes.request('post', '/api/workspaces/provision-default', { body: input })
		},
		async getSelection() {
			return routes.request('get', '/api/selection')
		},
		async setSelection(workspaceId: string, portfolioId: string) {
			return routes.request('post', '/api/selection', { body: { workspaceId, portfolioId } })
		},
		async clearSelection() {
			return routes.request('delete', '/api/selection')
		},
	}
}

export type ServerApi = ReturnType<typeof createServerApi>

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
