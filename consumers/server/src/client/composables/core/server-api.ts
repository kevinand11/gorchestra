import axios from 'axios'

import { createRouteContractAxiosClient } from '../../utils/server-api-route-client'

export type ServerApiOptions = {
	baseURL?: string
	headers?: { cookie: string }
}

export type CreateMemoryInput = {
	parentId: string | null
	title: string
	body: string
}

export type CreateMemoryRevisionInput = {
	expectedCurrentRevisionId: string
	title: string
	body: string
}

export type JsonObject = Record<string, unknown>
export type ModelProviderProtocol = 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages' | 'google-generative-ai'
export type ModelProviderProtocolType = ModelProviderProtocol
export type ModelProviderSource =
	| { type: 'openai-responses' }
	| { type: 'anthropic' }
	| { type: 'google' }
	| { type: 'groq' }
	| { type: 'custom-hosted'; protocol: ModelProviderProtocol; baseUrl: string }
export type ModelProviderAccessValue = { type: 'secret'; secretId: string }
export type ModelProviderAuth = { value: ModelProviderAccessValue }
export type ModelProviderHeader = { name: string; value: ModelProviderAccessValue }
export type ModelThinkingLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type PositiveModelThinkingLevel = Exclude<ModelThinkingLevel, 'none'>
export type ModelThinkingCapability = { supportedLevels: PositiveModelThinkingLevel[] }
export type ModelCapabilities = {
	inputs: Array<'text'>
	contextWindowTokens: number
	maxOutputTokens: number
	thinking: ModelThinkingCapability | null
}
export type ModelTokenPricing = {
	unit: 'micro-usd-per-million-tokens'
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}
export type ModelUseConfig = { modelId: string; thinkingLevel: ModelThinkingLevel }
export type AgentRunProfileInput = { name: string; modelUse: ModelUseConfig }

export type DeliveryWorkConfigInput = {
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
	executionAgentRunProfileId: string
	revisionExecutionAgentRunProfileId: string | null
}

export type ProjectConfigInput = { work: DeliveryWorkConfigInput }

export type SendAgentRunMessageInput = { content: Array<{ type: 'text'; text: string }> }

export type CreateModelProviderInput = {
	name: string
	source: ModelProviderSource
	auth: ModelProviderAuth | null
	headers: ModelProviderHeader[]
	providerOptions: JsonObject | null
}

export type UpdateModelProviderInput = Omit<CreateModelProviderInput, 'source'>
export type CreateModelInput = { name: string; providerModelId: string; providerOptions: JsonObject | null }
export type UpdateModelInput = {
	name: string
	providerOptions: JsonObject | null
	capabilities: ModelCapabilities
	pricing: ModelTokenPricing | null
}

type ServerApiOptionsResolver = () => ServerApiOptions | null
type PreconditionRequiredHandler = () => void | Promise<void>
type AuthenticationLostHandler = () => void | Promise<void>

const notAuthenticatedStatusCode = 401
const preconditionRequiredStatusCode = 428
const tokenExpiredStatusCode = 461

let serverApiOptionsResolver: ServerApiOptionsResolver | null = null
let preconditionRequiredHandler: PreconditionRequiredHandler | null = null
let authenticationLostHandler: AuthenticationLostHandler | null = null

export function setServerApiOptionsResolver(resolver: ServerApiOptionsResolver): void {
	serverApiOptionsResolver = resolver
}

export function setPreconditionRequiredHandler(handler: PreconditionRequiredHandler): void {
	preconditionRequiredHandler = handler
}

export function setAuthenticationLostHandler(handler: AuthenticationLostHandler): void {
	authenticationLostHandler = handler
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
	client.interceptors.response.use((response) => response, handleServerApiResponseError)
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
		async createProject(input: { title: string; config: ProjectConfigInput }) {
			return routes.request('post', '/api/portfolio/projects', { body: input })
		},
		async getProject(projectId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId', { params: { projectId } })
		},
		async setProjectConfig(projectId: string, input: { config: ProjectConfigInput }) {
			return routes.request('put', '/api/portfolio/projects/:projectId/config', { params: { projectId }, body: input })
		},
		async listPlans(projectId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/plans', { params: { projectId } })
		},
		async createPlan(projectId: string, input: { title: string; initialMessage: string; agentRunProfileId: string }) {
			return routes.request('post', '/api/portfolio/projects/:projectId/plans', { params: { projectId }, body: input })
		},
		async getPlan(projectId: string, planId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/plans/:planId', { params: { projectId, planId } })
		},
		async closePlan(projectId: string, planId: string) {
			return routes.request('post', '/api/portfolio/projects/:projectId/plans/:planId/close', { params: { projectId, planId } })
		},
		async getAgentRunEvents(agentRunId: string, input: { afterCursor?: string; limit?: number } = {}) {
			return routes.request('get', '/api/portfolio/agent-runs/:agentRunId/events', {
				params: { agentRunId },
				query: { afterCursor: input.afterCursor, limit: input.limit },
			})
		},
		async sendAgentRunMessage(agentRunId: string, input: SendAgentRunMessageInput) {
			return routes.request('post', '/api/portfolio/agent-runs/:agentRunId/messages', { params: { agentRunId }, body: input })
		},
		async listAgentRunProfiles() {
			return routes.request('get', '/api/portfolio/agent-run-profiles')
		},
		async createAgentRunProfile(input: AgentRunProfileInput) {
			return routes.request('post', '/api/portfolio/agent-run-profiles', { body: input })
		},
		async getAgentRunProfile(agentRunProfileId: string) {
			return routes.request('get', '/api/portfolio/agent-run-profiles/:agentRunProfileId', { params: { agentRunProfileId } })
		},
		async updateAgentRunProfile(agentRunProfileId: string, input: AgentRunProfileInput) {
			return routes.request('put', '/api/portfolio/agent-run-profiles/:agentRunProfileId', {
				params: { agentRunProfileId },
				body: input,
			})
		},
		async archiveAgentRunProfile(agentRunProfileId: string) {
			return routes.request('post', '/api/portfolio/agent-run-profiles/:agentRunProfileId/archive', { params: { agentRunProfileId } })
		},
		async unarchiveAgentRunProfile(agentRunProfileId: string) {
			return routes.request('post', '/api/portfolio/agent-run-profiles/:agentRunProfileId/unarchive', {
				params: { agentRunProfileId },
			})
		},
		async listModelProviders() {
			return routes.request('get', '/api/portfolio/model-providers')
		},
		async createModelProvider(input: CreateModelProviderInput) {
			return routes.request('post', '/api/portfolio/model-providers', { body: input })
		},
		async getModelProvider(modelProviderId: string) {
			return routes.request('get', '/api/portfolio/model-providers/:modelProviderId', { params: { modelProviderId } })
		},
		async updateModelProvider(modelProviderId: string, input: UpdateModelProviderInput) {
			return routes.request('put', '/api/portfolio/model-providers/:modelProviderId', { params: { modelProviderId }, body: input })
		},
		async archiveModelProvider(modelProviderId: string) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/archive', { params: { modelProviderId } })
		},
		async unarchiveModelProvider(modelProviderId: string) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/unarchive', { params: { modelProviderId } })
		},
		async createModel(modelProviderId: string, input: CreateModelInput) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/models', {
				params: { modelProviderId },
				body: input,
			})
		},
		async getModel(modelProviderId: string, modelId: string) {
			return routes.request('get', '/api/portfolio/model-providers/:modelProviderId/models/:modelId', {
				params: { modelProviderId, modelId },
			})
		},
		async listModelReferences(modelProviderId: string, modelId: string) {
			return routes.request('get', '/api/portfolio/model-providers/:modelProviderId/models/:modelId/references', {
				params: { modelProviderId, modelId },
			})
		},
		async updateModel(modelProviderId: string, modelId: string, input: UpdateModelInput) {
			return routes.request('put', '/api/portfolio/model-providers/:modelProviderId/models/:modelId', {
				params: { modelProviderId, modelId },
				body: input,
			})
		},
		async archiveModel(modelProviderId: string, modelId: string) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/models/:modelId/archive', {
				params: { modelProviderId, modelId },
			})
		},
		async unarchiveModel(modelProviderId: string, modelId: string) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/models/:modelId/unarchive', {
				params: { modelProviderId, modelId },
			})
		},
		async preflightModel(modelProviderId: string, modelId: string) {
			return routes.request('post', '/api/portfolio/model-providers/:modelProviderId/models/:modelId/preflight', {
				params: { modelProviderId, modelId },
			})
		},
		async listDeliveries(projectId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/deliveries', { params: { projectId } })
		},
		async getDelivery(projectId: string, deliveryId: string) {
			return routes.request('get', '/api/portfolio/projects/:projectId/deliveries/:deliveryId', {
				params: { projectId, deliveryId },
			})
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
		async listMemoryChildren(parentId: string | null) {
			return routes.request('get', '/api/portfolio/memories', { query: { parentId: queryValue(parentId) } })
		},
		async createMemory(input: CreateMemoryInput) {
			return routes.request('post', '/api/portfolio/memories', { body: input })
		},
		async getMemory(memoryId: string) {
			return routes.request('get', '/api/portfolio/memories/:memoryId', { params: { memoryId } })
		},
		async createMemoryRevision(memoryId: string, input: CreateMemoryRevisionInput) {
			return routes.request('post', '/api/portfolio/memories/:memoryId/revisions', { params: { memoryId }, body: input })
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

function queryValue<T>(value: T): T {
	return (typeof value === 'string' ? value : JSON.stringify(value)) as T
}

async function handleServerApiResponseError(error: unknown): Promise<never> {
	await runServerApiBoundaryHandler(error)
	throw error
}

async function runServerApiBoundaryHandler(error: unknown): Promise<void> {
	const handler = serverApiBoundaryHandler(error)
	if (handler !== null) await handler()
}

function serverApiBoundaryHandler(error: unknown): (() => void | Promise<void>) | null {
	if (shouldHandleAuthenticationLost(error)) return authenticationLostHandler
	if (shouldHandlePreconditionRequired(error)) return preconditionRequiredHandler
	return null
}

function shouldHandleAuthenticationLost(error: unknown): boolean {
	const statusCode = getHttpStatusCode(error)
	return typeof window !== 'undefined' && (statusCode === notAuthenticatedStatusCode || statusCode === tokenExpiredStatusCode)
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

	describe('Server API auth boundary handling', () => {
		it('extracts Axios HTTP status codes', () => {
			expect(getHttpStatusCode({ response: { status: 428 } })).toBe(428)
			expect(getHttpStatusCode({ response: { status: '428' } })).toBeNull()
			expect(getHttpStatusCode(new Error('network'))).toBeNull()
		})

		it('detects browser auth-loss statuses', () => {
			const originalWindow = globalThis.window
			Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })

			expect(shouldHandleAuthenticationLost({ response: { status: 401 } })).toBe(true)
			expect(shouldHandleAuthenticationLost({ response: { status: 461 } })).toBe(true)
			expect(shouldHandleAuthenticationLost({ response: { status: 428 } })).toBe(false)

			Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
		})
	})
}
