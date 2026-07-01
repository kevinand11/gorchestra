import {
	createAnthropicMessagesModelProviderProtocolProvider,
	type AnthropicMessagesModelProviderProtocolProvider,
} from './anthropic-messages'
import {
	createGoogleGenerativeAIModelProviderProtocolProvider,
	type GoogleGenerativeAIModelProviderProtocolProvider,
} from './google-generative-ai'
import {
	createOpenAICompletionsModelProviderProtocolProvider,
	type OpenAICompletionsModelProviderProtocolProvider,
} from './openai-completions'
import { createOpenAIResponsesModelProviderProtocolProvider, type OpenAIResponsesModelProviderProtocolProvider } from './openai-responses'
import type {
	ModelAgentTurnInput,
	ModelAgentTurnOutput,
	ModelProviderProtocolAccess,
	ModelProviderProtocolPreflight,
	ModelProviderProtocolPreflightError,
	ModelProviderProtocolPreflightFailureReason,
	ModelProviderProtocolPreflightModelInput,
	ModelProviderProtocolProviderPreflightModelInput,
	ModelProviderProtocolProviders,
} from './types'
import type { Id } from '../../domain/commons'
import type { ModelProvider, ModelProviderProtocol } from '../../domain/model-provider'
import { resolvedSecretValuesPipe, type CoreServices, type ResolvableSecretValue, type ResolvedSecretValues } from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

export interface ModelProviderProtocolProviderImplementations {
	anthropicMessages?: AnthropicMessagesModelProviderProtocolProvider
	openAIResponses?: OpenAIResponsesModelProviderProtocolProvider
	openAICompletions?: OpenAICompletionsModelProviderProtocolProvider
	googleGenerativeAI?: GoogleGenerativeAIModelProviderProtocolProvider
}

export function createModelProviderProtocolProviders(
	services: CoreServices,
	implementations: ModelProviderProtocolProviderImplementations = {},
): ModelProviderProtocolProviders {
	const concrete = createConcreteProviders(implementations)

	return {
		preflightModel(input) {
			return preflightModelWithConcreteProviders(services, concrete, input)
		},
		runModelAgentTurn(input) {
			return runModelAgentTurnWithConcreteProviders(services, concrete, input)
		},
	}
}

function createConcreteProviders(
	implementations: ModelProviderProtocolProviderImplementations,
): Required<ModelProviderProtocolProviderImplementations> {
	return {
		anthropicMessages: createAnthropicMessagesModelProviderProtocolProvider(),
		openAIResponses: createOpenAIResponsesModelProviderProtocolProvider(),
		openAICompletions: createOpenAICompletionsModelProviderProtocolProvider(),
		googleGenerativeAI: createGoogleGenerativeAIModelProviderProtocolProvider(),
		...implementations,
	}
}

async function preflightModelWithConcreteProviders(
	services: CoreServices,
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: ModelProviderProtocolPreflightModelInput,
): Promise<Result<ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>> {
	const access = await resolveModelProviderProtocolAccess(services, input.modelProvider, input.secrets)
	if (!access.ok) return access
	if (!isProtocolAccess(access.value)) return { ok: true, value: access.value }

	const preflight = await concretePreflight(concrete, input, access.value)
	return { ok: true, value: modelProviderProtocolPreflight(input.modelProvider.protocol, preflight) }
}

async function runModelAgentTurnWithConcreteProviders(
	services: CoreServices,
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: ModelAgentTurnInput,
): Promise<Result<ModelAgentTurnOutput, ModelProviderProtocolPreflightError>> {
	const access = await resolveModelProviderProtocolAccess(services, input.modelProvider, [])
	if (!access.ok) return access
	if (!isProtocolAccess(access.value))
		return { ok: true, value: { outcome: { type: 'error', message: null, summary: access.value.summary } } }

	const concreteProvider = concreteProviderForProtocol(concrete, input.modelProvider.protocol)
	return concreteProvider.runModelAgentTurn === undefined
		? {
				ok: true,
				value: {
					outcome: { type: 'error', message: null, summary: `${input.modelProvider.protocol} agent turns are not implemented.` },
				},
			}
		: {
				ok: true,
				value: await concreteProvider.runModelAgentTurn({
					...input,
					modelProvider: input.modelProvider as never,
					access: access.value,
				}),
			}
}

function concreteProviderForProtocol(concrete: Required<ModelProviderProtocolProviderImplementations>, protocol: ModelProviderProtocol) {
	return {
		'anthropic-messages': concrete.anthropicMessages,
		'openai-responses': concrete.openAIResponses,
		'openai-completions': concrete.openAICompletions,
		'google-generative-ai': concrete.googleGenerativeAI,
	}[protocol]
}

function concretePreflight(
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: ModelProviderProtocolPreflightModelInput,
	access: ModelProviderProtocolAccess,
) {
	return concretePreflightDispatch(concrete, input, access)[input.modelProvider.protocol]()
}

function concretePreflightDispatch(
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: ModelProviderProtocolPreflightModelInput,
	access: ModelProviderProtocolAccess,
) {
	return {
		'anthropic-messages': () => concrete.anthropicMessages.preflightModel(protocolProviderInput(input, access, 'anthropic-messages')),
		'openai-responses': () => concrete.openAIResponses.preflightModel(protocolProviderInput(input, access, 'openai-responses')),
		'openai-completions': () => concrete.openAICompletions.preflightModel(protocolProviderInput(input, access, 'openai-completions')),
		'google-generative-ai': () =>
			concrete.googleGenerativeAI.preflightModel(protocolProviderInput(input, access, 'google-generative-ai')),
	}
}

export function modelProviderProtocolPreflight(
	protocol: ModelProviderProtocol,
	preflight: { type: 'passed' } | { type: 'failed'; reason: ModelProviderProtocolPreflightFailureReason },
): ModelProviderProtocolPreflight {
	return preflight.type === 'passed'
		? { type: 'passed', summary: `${protocolDisplayName(protocol)} model preflight passed.` }
		: { type: 'failed', reason: preflight.reason, summary: modelProviderProtocolFailureSummary(protocol, preflight.reason) }
}

type SecretValueResolution = { type: 'resolved'; output: unknown } | { type: 'failed'; preflight: ModelProviderProtocolPreflight }

async function resolveModelProviderProtocolAccess(
	services: CoreServices,
	modelProvider: ModelProvider,
	secrets: ResolvableSecretValue[],
): Promise<Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>> {
	const secretIds = secretIdsFromModelProvider(modelProvider)
	if (secretIds.length === 0) return { ok: true, value: { auth: null, headers: [] } }

	const secretValues = secretValuesForIds(secretIds, secrets)
	const missingSecret = secretValues.find(isMissingSecretValueRef)
	if (missingSecret !== undefined) return { ok: true, value: unresolvedSecretPreflight(modelProvider.protocol, missingSecret.secretId) }

	const resolution = await resolveSecretValueOutput(services, modelProvider.protocol, secretValues.filter(isResolvableSecretValue))
	return resolution.ok ? accessFromSecretValueResolution(resolution.value, modelProvider) : resolution
}

async function resolveSecretValueOutput(
	services: CoreServices,
	protocol: ModelProviderProtocol,
	secrets: ResolvableSecretValue[],
): Promise<Result<SecretValueResolution, ModelProviderProtocolPreflightError>> {
	try {
		return { ok: true, value: { type: 'resolved', output: await services.secrets.resolveSecretValues({ secrets }) } }
	} catch {
		return { ok: true, value: { type: 'failed', preflight: unresolvedSecretPreflight(protocol, secrets[0]!.secretId) } }
	}
}

function accessFromSecretValueResolution(
	resolution: SecretValueResolution,
	modelProvider: ModelProvider,
): Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError> {
	return resolution.type === 'failed'
		? { ok: true, value: resolution.preflight }
		: accessFromResolvedSecretValues(resolution.output, modelProvider)
}

function accessFromResolvedSecretValues(
	output: unknown,
	modelProvider: ModelProvider,
): Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError> {
	const shapeValidation = validateCoreServiceOutput(resolvedSecretValuesPipe, output, 'secrets', 'resolveSecretValues')
	if (!shapeValidation.ok) return shapeValidation

	const missingSecretId = secretIdsFromModelProvider(modelProvider).find((secretId) => shapeValidation.value[secretId] === undefined)
	return missingSecretId === undefined
		? { ok: true, value: resolvedAccess(modelProvider, shapeValidation.value) }
		: { ok: true, value: unresolvedSecretPreflight(modelProvider.protocol, missingSecretId) }
}

function resolvedAccess(modelProvider: ModelProvider, values: ResolvedSecretValues): ModelProviderProtocolAccess {
	return {
		auth: modelProvider.auth === null ? null : { type: 'apiKey', plaintext: values[modelProvider.auth.secretId] ?? '' },
		headers: modelProvider.headers.map((header) => ({ name: header.name, plaintext: values[header.valueSecretId] ?? '' })),
	}
}

function secretIdsFromModelProvider(modelProvider: ModelProvider): Id[] {
	const secretIds = [modelProvider.auth?.secretId, ...modelProvider.headers.map((header) => header.valueSecretId)].filter(
		(secretId): secretId is Id => secretId !== undefined,
	)

	return [...new Set(secretIds)]
}

function secretValuesForIds(
	secretIds: Id[],
	secrets: ResolvableSecretValue[],
): Array<ResolvableSecretValue | { secretId: Id; valueRef: null }> {
	const secretsById = new Map(secrets.map((secret) => [secret.secretId, secret]))
	return secretIds.map((secretId) => secretsById.get(secretId) ?? { secretId, valueRef: null })
}

function isMissingSecretValueRef(
	secret: ResolvableSecretValue | { secretId: Id; valueRef: null },
): secret is { secretId: Id; valueRef: null } {
	return secret.valueRef === null
}

function isResolvableSecretValue(secret: ResolvableSecretValue | { secretId: Id; valueRef: null }): secret is ResolvableSecretValue {
	return secret.valueRef !== null
}

function unresolvedSecretPreflight(protocol: ModelProviderProtocol, secretId: Id): ModelProviderProtocolPreflight {
	return modelProviderProtocolPreflight(protocol, { type: 'failed', reason: { type: 'model-provider-secret-unresolved', secretId } })
}

function protocolProviderInput<Protocol extends ModelProviderProtocol>(
	input: ModelProviderProtocolPreflightModelInput,
	access: ModelProviderProtocolAccess,
	protocol: Protocol,
): ModelProviderProtocolProviderPreflightModelInput<Protocol> {
	return { ...input, modelProvider: { ...input.modelProvider, protocol }, access }
}

function isProtocolAccess(value: ModelProviderProtocolAccess | ModelProviderProtocolPreflight): value is ModelProviderProtocolAccess {
	return 'auth' in value
}

const modelProviderProtocolFailureSummaries: Record<ModelProviderProtocolPreflightFailureReason['type'], (name: string) => string> = {
	'model-archived': (name) => `${name} Model is archived.`,
	'model-provider-archived': (name) => `${name} Model Provider is archived.`,
	'model-provider-auth-secret-missing': (name) => `${name} model provider auth Secret is missing.`,
	'model-provider-auth-secret-inactive': (name) => `${name} model provider auth Secret is not active.`,
	'model-provider-header-secret-missing': (name) => `${name} model provider header Secret is missing.`,
	'model-provider-header-secret-inactive': (name) => `${name} model provider header Secret is not active.`,
	'model-provider-secret-unresolved': (name) => `${name} model provider Secret value could not be resolved.`,
	'provider-authentication-failed': (name) => `${name} authentication failed.`,
	'provider-access-denied': (name) => `${name} access was denied.`,
	'provider-model-not-found': (name) => `${name} model was not found.`,
	'provider-unavailable': (name) => `${name} model preflight failed.`,
	'provider-preflight-not-implemented': (name) => `${name} model preflight is not implemented.`,
}

const protocolDisplayNames: Record<ModelProviderProtocol, string> = {
	'anthropic-messages': 'Anthropic Messages',
	'openai-responses': 'OpenAI Responses',
	'openai-completions': 'OpenAI Completions',
	'google-generative-ai': 'Google Generative AI',
}

export function modelProviderProtocolFailureSummary(
	protocol: ModelProviderProtocol,
	reason: ModelProviderProtocolPreflightFailureReason,
): string {
	return modelProviderProtocolFailureSummaries[reason.type](protocolDisplayName(protocol))
}

function protocolDisplayName(protocol: ModelProviderProtocol): string {
	return protocolDisplayNames[protocol]
}

export type { AnthropicMessagesModelProviderProtocolProvider } from './anthropic-messages'
export type { GoogleGenerativeAIModelProviderProtocolProvider } from './google-generative-ai'
export type { OpenAICompletionsModelProviderProtocolProvider } from './openai-completions'
export type { OpenAIResponsesModelProviderProtocolProvider } from './openai-responses'
export type {
	ModelAgentTurnInput,
	ModelAgentTurnOutput,
	ModelProviderProtocolAccess,
	ModelProviderProtocolPreflight,
	ModelProviderProtocolPreflightError,
	ModelProviderProtocolPreflightFailureReason,
	ModelProviderProtocolProvider,
	ModelProviderProtocolProviderPreflight,
	ModelProviderProtocolProviderPreflightModelInput,
	ModelProviderProtocolProviders,
} from './types'

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Model Provider Protocol family', () => {
		it('resolves OpenAI Responses access Secrets and dispatches to the concrete provider', async () => {
			const services = coreServices(() => Promise.resolve({ 'secret-1': 'token', 'secret-2': 'org-1' }))
			let observedAccess: ModelProviderProtocolAccess | null = null
			const providers = createModelProviderProtocolProviders(services, {
				openAIResponses: {
					preflightModel(input) {
						observedAccess = input.access
						return Promise.resolve({ type: 'passed' })
					},
				},
			})

			const result = await providers.preflightModel(openAIResponsesPreflightInput())

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'OpenAI Responses model preflight passed.' } })
			expect(observedAccess).toEqual({
				auth: { type: 'apiKey', plaintext: 'token' },
				headers: [{ name: 'OpenAI-Organization', plaintext: 'org-1' }],
			})
		})

		it('dispatches OpenAI Completions preflight', async () => {
			const services = coreServices(() => Promise.resolve({ 'secret-1': 'token', 'secret-2': 'org-1' }))
			let observedProviderModelId: string | null = null
			const providers = createModelProviderProtocolProviders(services, {
				openAICompletions: {
					preflightModel(input) {
						observedProviderModelId = input.model.providerModelId
						return Promise.resolve({ type: 'passed' })
					},
				},
			})

			const result = await providers.preflightModel({
				...openAIResponsesPreflightInput(),
				modelProvider: openAICompletionsModelProvider(),
			})

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'OpenAI Completions model preflight passed.' } })
			expect(observedProviderModelId).toBe('gpt-5')
		})

		it('returns failed preflight when a requested Secret value is missing', async () => {
			const services = coreServices(() => Promise.resolve({ 'secret-1': 'token' }))
			const providers = createModelProviderProtocolProviders(services, { openAIResponses: neverCalledOpenAIResponsesProvider() })

			const result = await providers.preflightModel(openAIResponsesPreflightInput())

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'model-provider-secret-unresolved', secretId: 'secret-2' },
					summary: 'OpenAI Responses model provider Secret value could not be resolved.',
				},
			})
		})

		it('dispatches Anthropic Messages preflight', async () => {
			const providers = createModelProviderProtocolProviders(
				coreServices(() => Promise.resolve({})),
				{
					anthropicMessages: {
						preflightModel: () => Promise.resolve({ type: 'failed', reason: { type: 'provider-model-not-found' } }),
					},
				},
			)

			const result = await providers.preflightModel({ ...openAIResponsesPreflightInput(), modelProvider: anthropicModelProvider() })

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'provider-model-not-found' },
					summary: 'Anthropic Messages model was not found.',
				},
			})
		})

		it('dispatches Google Generative AI preflight', async () => {
			const providers = createModelProviderProtocolProviders(
				coreServices(() => Promise.resolve({})),
				{
					googleGenerativeAI: {
						preflightModel: () => Promise.resolve({ type: 'passed' }),
					},
				},
			)

			const result = await providers.preflightModel({
				...openAIResponsesPreflightInput(),
				modelProvider: googleGenerativeAIModelProvider(),
			})

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'Google Generative AI model preflight passed.' } })
		})
	})

	function openAIResponsesPreflightInput(): ModelProviderProtocolPreflightModelInput {
		return {
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'GPT 5',
				providerModelId: 'gpt-5',
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: openAIResponsesModelProvider(),
			secrets: [
				{ secretId: 'secret-1', valueRef: 'protected-ref-1' },
				{ secretId: 'secret-2', valueRef: 'protected-ref-2' },
			],
		}
	}

	function openAIResponsesModelProvider(): ModelProvider {
		return {
			id: 'model-provider-1',
			name: 'OpenAI',
			protocol: 'openai-responses',
			baseUrl: 'https://api.openai.com/v1',
			auth: { type: 'apiKey', secretId: 'secret-1' },
			headers: [{ name: 'OpenAI-Organization', valueSecretId: 'secret-2' }],
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}

	function openAICompletionsModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: 'openai-completions' }
	}

	function anthropicModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: 'anthropic-messages', auth: null, headers: [] }
	}

	function googleGenerativeAIModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: 'google-generative-ai', auth: null, headers: [] }
	}

	function neverCalledOpenAIResponsesProvider(): OpenAIResponsesModelProviderProtocolProvider {
		return {
			preflightModel() {
				throw new Error('OpenAI Responses provider should not be called.')
			},
		}
	}

	function coreServices(resolveSecretValues: CoreServices['secrets']['resolveSecretValues']): CoreServices {
		return {
			storage: unusedStorageService(),
			secrets: secretService(resolveSecretValues),
			sandbox: { preflight: () => Promise.resolve({ ok: true }) },
		}
	}

	function unusedStorageService(): CoreServices['storage'] {
		return {
			on: () => {
				throw new Error('Storage should not be called.')
			},
			session: () => Promise.reject(new Error('Storage should not be called.')),
			resolve: () => Promise.reject(new Error('Storage should not be called.')),
		} as never
	}

	function secretService(resolveSecretValues: CoreServices['secrets']['resolveSecretValues']): CoreServices['secrets'] {
		return {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues,
		}
	}
}
