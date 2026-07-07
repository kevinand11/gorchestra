import { streamText } from 'ai'

import {
	createAnthropicMessagesModelProviderProtocolProvider,
	type AnthropicMessagesModelProviderProtocolProvider,
} from './anthropic-messages'
import {
	createGoogleGenerativeAIModelProviderProtocolProvider,
	type GoogleGenerativeAIModelProviderProtocolProvider,
} from './google-generative-ai'
import {
	createOpenAIChatCompletionsModelProviderProtocolProvider,
	type OpenAIChatCompletionsModelProviderProtocolProvider,
} from './openai-chat-completions'
import { createOpenAIResponsesModelProviderProtocolProvider, type OpenAIResponsesModelProviderProtocolProvider } from './openai-responses'
import { providerFailureReason } from './provider-failures'
import type {
	AISDKLanguageModelResolution,
	AISDKLanguageModelResolutionInput,
	ModelAgentTurnAccessError,
	ModelProviderProtocolAccess,
	ModelProviderProtocolPreflight,
	ModelProviderProtocolPreflightError,
	ModelProviderProtocolPreflightFailureReason,
	ModelProviderProtocolPreflightModelInput,
	ModelProviderProtocolProviderResolveInput,
	ModelProviderProtocolProviders,
	ResolveAISDKLanguageModelError,
} from './types'
import type { TurnErrorReason } from '../../domain/agent-run'
import type { ArchivePeriod, Id } from '../../domain/commons'
import {
	modelProviderProtocolForSource,
	type ModelProvider,
	type ModelProviderAccessValue,
	type ModelProviderHeader,
	type ModelProviderProtocol,
} from '../../domain/model-provider'
import type { Secret } from '../../domain/secret'
import type { CoreStorageOperation, SecretResolutionFailedError } from '../../errors'
import type { CoreServices, CoreStorage, ResolvableSecretValue } from '../../services'
import { secretSchema } from '../../storage/schemas'
import { withTransaction } from '../../storage/transactions'
import { resolveSecretValueRefs } from '../../utils/secrets'
import type { Result } from '../../utils/types'

export interface ModelProviderProtocolProviderImplementations {
	anthropicMessages?: AnthropicMessagesModelProviderProtocolProvider
	openAIResponses?: OpenAIResponsesModelProviderProtocolProvider
	openAIChatCompletions?: OpenAIChatCompletionsModelProviderProtocolProvider
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
		resolveLanguageModel(input) {
			return resolveLanguageModelWithConcreteProviders(services, concrete, input)
		},
	}
}

function createConcreteProviders(
	implementations: ModelProviderProtocolProviderImplementations,
): Required<ModelProviderProtocolProviderImplementations> {
	return {
		anthropicMessages: createAnthropicMessagesModelProviderProtocolProvider(),
		openAIResponses: createOpenAIResponsesModelProviderProtocolProvider(),
		openAIChatCompletions: createOpenAIChatCompletionsModelProviderProtocolProvider(),
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

	const resolution = concreteResolveLanguageModel(concrete, { ...input, mode: 'preflight', access: access.value })
	const protocol = modelProviderProtocolForSource(input.modelProvider.source)
	if (!resolution.ok)
		return {
			ok: true,
			value: modelProviderProtocolPreflight(protocol, { type: 'failed', reason: resolution.error }),
		}

	const preflight = await runGenerationPreflight(resolution.value)
	return { ok: true, value: modelProviderProtocolPreflight(protocol, preflight) }
}

async function runGenerationPreflight(
	resolution: AISDKLanguageModelResolution,
): Promise<{ type: 'passed' } | { type: 'failed'; reason: ModelProviderProtocolPreflightFailureReason }> {
	try {
		const result = streamText({
			model: resolution.languageModel,
			messages: [{ role: 'user', content: 'Reply with OK.' }],
			maxOutputTokens: 4,
			maxRetries: 0,
			...(resolution.providerOptions === undefined ? {} : { providerOptions: resolution.providerOptions }),
		})
		for await (const part of result.stream) {
			if (part.type === 'error') throw part.error
		}
		const finishReason = await result.finishReason
		return finishReason === 'content-filter'
			? { type: 'failed', reason: { type: 'provider-content-filtered' } }
			: finishReason === 'error'
				? { type: 'failed', reason: { type: 'provider-generation-failed' } }
				: { type: 'passed' }
	} catch (error) {
		return { type: 'failed', reason: providerFailureReason(error) }
	}
}

async function resolveLanguageModelWithConcreteProviders(
	services: CoreServices,
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: Omit<Extract<AISDKLanguageModelResolutionInput, { mode: 'agent-run' }>, 'access'>,
): Promise<Result<AISDKLanguageModelResolution | TurnErrorReason, ResolveAISDKLanguageModelError | ModelAgentTurnAccessError>> {
	const access = await resolveModelProviderProtocolAccessFromStorage(services, input.modelProvider)
	if (!access.ok) return access
	if (!isProtocolAccess(access.value)) return { ok: true, value: modelAccessFailureOutcome(access.value) }

	const resolution = concreteResolveLanguageModel(concrete, { ...input, access: access.value })
	return resolution.ok ? resolution : resolution
}

function concreteResolveLanguageModel(
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: AISDKLanguageModelResolutionInput,
): Result<AISDKLanguageModelResolution, ResolveAISDKLanguageModelError> {
	const protocol = modelProviderProtocolForSource(input.modelProvider.source)
	switch (protocol) {
		case 'anthropic-messages':
			return concrete.anthropicMessages.resolveLanguageModel(protocolProviderInput(input, protocol))
		case 'openai-responses':
			return concrete.openAIResponses.resolveLanguageModel(protocolProviderInput(input, protocol))
		case 'openai-chat-completions':
			return concrete.openAIChatCompletions.resolveLanguageModel(protocolProviderInput(input, protocol))
		case 'google-generative-ai':
			return concrete.googleGenerativeAI.resolveLanguageModel(protocolProviderInput(input, protocol))
		default:
			throw new Error(`Unexpected Model Provider Protocol: ${String(protocol satisfies never)}`)
	}
}

function modelAccessFailureOutcome(_preflight: ModelProviderProtocolPreflight): TurnErrorReason {
	return { type: 'runtime-error' }
}

export function modelProviderProtocolPreflight(
	protocol: ModelProviderProtocol,
	preflight: { type: 'passed' } | { type: 'failed'; reason: ModelProviderProtocolPreflightFailureReason },
): ModelProviderProtocolPreflight {
	return preflight.type === 'passed'
		? { type: 'passed', summary: `${protocolDisplayName(protocol)} model preflight passed.` }
		: { type: 'failed', reason: preflight.reason, summary: modelProviderProtocolFailureSummary(protocol, preflight.reason) }
}

type ModelProviderSecretReadiness =
	| { type: 'passed'; secrets: ResolvableSecretValue[] }
	| { type: 'failed'; preflight: ModelProviderProtocolPreflight }

type ModelProviderSecretReadinessError = ModelAgentTurnAccessError

async function resolveModelProviderProtocolAccessFromStorage(
	services: CoreServices,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelAgentTurnAccessError>> {
	const secrets = await readModelProviderSecretReadiness(services, modelProvider)
	if (!secrets.ok) return secrets
	return secrets.value.type === 'failed'
		? { ok: true, value: secrets.value.preflight }
		: resolveModelProviderProtocolAccess(services, modelProvider, secrets.value.secrets)
}

function readModelProviderSecretReadiness(
	services: CoreServices,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	return withTransaction(services, (storage) => readModelProviderSecretReadinessFromStorage(storage, modelProvider))
}

async function readModelProviderSecretReadinessFromStorage(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	const auth = await readAuthSecretReadiness(storage, modelProvider)
	return auth.ok && auth.value.type === 'passed'
		? combineSecretReadiness(auth.value.secrets, await readHeaderSecretReadiness(storage, modelProvider))
		: auth
}

function readAuthSecretReadiness(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	return modelProvider.auth === null
		? Promise.resolve({ ok: true, value: { type: 'passed', secrets: [] } })
		: readSecretReadiness(storage, modelProvider, secretIdFromAccessValue(modelProvider.auth.value), {
				missing: { type: 'model-provider-auth-secret-missing', secretId: secretIdFromAccessValue(modelProvider.auth.value) },
				inactive: { type: 'model-provider-auth-secret-inactive', secretId: secretIdFromAccessValue(modelProvider.auth.value) },
			})
}

async function readHeaderSecretReadiness(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	const secrets: ResolvableSecretValue[] = []
	for (const header of modelProvider.headers) {
		const secret = await readHeaderSecretRef(storage, modelProvider, header)
		if (!secret.ok || secret.value.type === 'failed') return secret
		secrets.push(...secret.value.secrets)
	}
	return { ok: true, value: { type: 'passed', secrets } }
}

function readHeaderSecretRef(
	storage: CoreStorage,
	modelProvider: ModelProvider,
	header: ModelProviderHeader,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	const secretId = secretIdFromAccessValue(header.value)
	return readSecretReadiness(storage, modelProvider, secretId, {
		missing: { type: 'model-provider-header-secret-missing', secretId, headerName: header.name },
		inactive: { type: 'model-provider-header-secret-inactive', secretId, headerName: header.name },
	})
}

async function readSecretReadiness(
	storage: CoreStorage,
	modelProvider: ModelProvider,
	secretId: Id,
	reasons: SecretFailureReasons,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	const secret = await findSecret(storage, secretId)
	if (!secret.ok) return secret
	if (secret.value === null) return ok(secretFailure(modelProvider, reasons.missing))
	return isArchived(secret.value.archivePeriods)
		? ok(secretFailure(modelProvider, reasons.inactive))
		: ok({ type: 'passed', secrets: [{ secretId: secret.value.id, valueRef: secret.value.valueRef }] })
}

async function findSecret(storage: CoreStorage, secretId: Id): Promise<Result<Secret | null, ModelProviderSecretReadinessError>> {
	try {
		const secret = await storage.on(secretSchema).one().id(secretId).find()
		return ok(secret)
	} catch {
		return storageFailure({ type: 'get', resource: 'secret', id: secretId })
	}
}

type SecretFailureReasons = {
	missing: ModelProviderProtocolPreflightFailureReason
	inactive: ModelProviderProtocolPreflightFailureReason
}

function secretFailure(modelProvider: ModelProvider, reason: ModelProviderProtocolPreflightFailureReason): ModelProviderSecretReadiness {
	return {
		type: 'failed',
		preflight: modelProviderProtocolPreflight(modelProviderProtocolForSource(modelProvider.source), { type: 'failed', reason }),
	}
}

function combineSecretReadiness(
	authSecrets: ResolvableSecretValue[],
	headerSecrets: Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>,
): Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError> {
	return headerSecrets.ok && headerSecrets.value.type === 'passed'
		? ok({ type: 'passed', secrets: uniqueSecrets([...authSecrets, ...headerSecrets.value.secrets]) })
		: headerSecrets
}

function uniqueSecrets(secrets: ResolvableSecretValue[]): ResolvableSecretValue[] {
	return [...new Map(secrets.map((secret) => [secret.secretId, secret])).values()]
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}

function ok<TValue>(value: TValue): Result<TValue, never> {
	return { ok: true, value }
}

function storageFailure(operation: CoreStorageOperation): Result<never, ModelProviderSecretReadinessError> {
	return { ok: false, error: { type: 'storage-operation-failed', operation } }
}

async function resolveModelProviderProtocolAccess(
	services: CoreServices,
	modelProvider: ModelProvider,
	secrets: ResolvableSecretValue[],
): Promise<Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>> {
	const secretIds = secretIdsFromModelProvider(modelProvider)
	if (secretIds.length === 0) return { ok: true, value: { auth: null, headers: [] } }

	const secretValues = secretValuesForIds(secretIds, secrets)
	const missingSecret = secretValues.find(isMissingSecretValueRef)
	const protocol = modelProviderProtocolForSource(modelProvider.source)
	if (missingSecret !== undefined) return { ok: true, value: unresolvedSecretPreflight(protocol, missingSecret.secretId) }

	const resolution = await resolveSecretValueRefs(services, secretValues.filter(isResolvableSecretValue))
	if (!resolution.ok) return resolution

	const unresolvedSecretId = secretIds.find((secretId) => {
		const resolved = resolution.value[secretId]
		return resolved === undefined || !resolved.ok
	})
	return unresolvedSecretId === undefined
		? { ok: true, value: resolvedAccess(modelProvider, resolution.value) }
		: { ok: true, value: unresolvedSecretPreflight(protocol, unresolvedSecretId) }
}

function resolvedAccess(
	modelProvider: ModelProvider,
	values: Record<Id, Result<string, SecretResolutionFailedError>>,
): ModelProviderProtocolAccess {
	return {
		auth: resolvedAuthAccess(modelProvider, values),
		headers: modelProvider.headers.map((header) => {
			const secretId = secretIdFromAccessValue(header.value)
			const value = values[secretId]
			return { name: header.name, plaintext: value?.ok === true ? value.value : '' }
		}),
	}
}

function resolvedAuthAccess(
	modelProvider: ModelProvider,
	values: Record<Id, Result<string, SecretResolutionFailedError>>,
): ModelProviderProtocolAccess['auth'] {
	if (modelProvider.auth === null) return null
	const secretId = secretIdFromAccessValue(modelProvider.auth.value)
	const value = values[secretId]
	return { type: 'apiKey', plaintext: value?.ok === true ? value.value : '' }
}

function secretIdsFromModelProvider(modelProvider: ModelProvider): Id[] {
	return [
		...new Set([
			...(modelProvider.auth === null ? [] : secretIdsFromAccessValue(modelProvider.auth.value)),
			...modelProvider.headers.flatMap((header) => secretIdsFromAccessValue(header.value)),
		]),
	]
}

function secretIdsFromAccessValue(value: ModelProviderAccessValue): Id[] {
	switch (value.type) {
		case 'secret':
			return [value.secretId]
		default:
			throw new Error('Unexpected Model Provider access value.')
	}
}

function secretIdFromAccessValue(value: ModelProviderAccessValue): Id {
	return secretIdsFromAccessValue(value)[0]!
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
	input: AISDKLanguageModelResolutionInput,
	protocol: Protocol,
): ModelProviderProtocolProviderResolveInput<Protocol> {
	return { ...input, protocol }
}

function isProtocolAccess(value: ModelProviderProtocolAccess | ModelProviderProtocolPreflight): value is ModelProviderProtocolAccess {
	return 'auth' in value
}

export function modelProviderProtocolFailureSummary(
	protocol: ModelProviderProtocol,
	reason: ModelProviderProtocolPreflightFailureReason,
): string {
	const name = protocolDisplayName(protocol)
	switch (reason.type) {
		case 'model-archived':
			return `${name} Model is archived.`
		case 'model-provider-archived':
			return `${name} Model Provider is archived.`
		case 'model-provider-auth-secret-missing':
			return `${name} model provider auth Secret is missing.`
		case 'model-provider-auth-secret-inactive':
			return `${name} model provider auth Secret is not active.`
		case 'model-provider-header-secret-missing':
			return `${name} model provider header Secret is missing.`
		case 'model-provider-header-secret-inactive':
			return `${name} model provider header Secret is not active.`
		case 'model-provider-secret-unresolved':
			return `${name} model provider Secret value could not be resolved.`
		case 'model-thinking-level-unavailable':
			return `${name} Model thinking level ${reason.thinkingLevel} is unavailable.`
		case 'provider-authentication-failed':
			return `${name} authentication failed.`
		case 'provider-access-denied':
			return `${name} access was denied.`
		case 'provider-model-not-found':
			return `${name} model was not found.`
		case 'provider-rate-limited':
			return `${name} rate limit was reached.`
		case 'provider-content-filtered':
			return `${name} content filter blocked generation.`
		case 'provider-unavailable':
			return `${name} model preflight failed because the provider was unavailable.`
		case 'provider-generation-failed':
			return `${name} model preflight generation failed.`
		default:
			throw new Error(`Unexpected Model Provider Protocol preflight failure reason: ${String(reason satisfies never)}`)
	}
}

function protocolDisplayName(protocol: ModelProviderProtocol): string {
	switch (protocol) {
		case 'anthropic-messages':
			return 'Anthropic Messages'
		case 'openai-responses':
			return 'OpenAI Responses'
		case 'openai-chat-completions':
			return 'OpenAI Chat Completions'
		case 'google-generative-ai':
			return 'Google Generative AI'
		default:
			throw new Error(`Unexpected Model Provider Protocol: ${String(protocol satisfies never)}`)
	}
}

export type { AnthropicMessagesModelProviderProtocolProvider } from './anthropic-messages'
export type { GoogleGenerativeAIModelProviderProtocolProvider } from './google-generative-ai'
export type { OpenAIChatCompletionsModelProviderProtocolProvider } from './openai-chat-completions'
export type { OpenAIResponsesModelProviderProtocolProvider } from './openai-responses'
export type {
	AISDKLanguageModelResolution,
	AISDKLanguageModelResolutionInput,
	ModelProviderProtocolAccess,
	ModelProviderProtocolPreflight,
	ModelProviderProtocolPreflightError,
	ModelProviderProtocolPreflightFailureReason,
	ModelProviderProtocolProvider,
	ModelProviderProtocolProviders,
	ResolveAISDKLanguageModelError,
} from './types'

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Model Provider Protocol family', () => {
		it('resolves OpenAI Responses access Secrets and dispatches to the concrete provider', async () => {
			const services = coreServices(() =>
				Promise.resolve({ '01k00000000000000000000040': 'token', '01k00000000000000000000041': 'org-1' }),
			)
			let observedAccess: ModelProviderProtocolAccess | null = null
			const providers = createModelProviderProtocolProviders(services, {
				openAIResponses: {
					resolveLanguageModel(input) {
						observedAccess = input.access
						return { ok: true, value: { languageModel: 'language-model', providerOptions: undefined } }
					},
				},
			})

			const result = await providers.preflightModel(openAIResponsesPreflightInput())

			expect(result).toMatchObject({ ok: true })
			expect(observedAccess).toEqual({
				auth: { type: 'apiKey', plaintext: 'token' },
				headers: [{ name: 'OpenAI-Organization', plaintext: 'org-1' }],
			})
		})

		it('returns failed preflight when a requested Secret value is missing', async () => {
			const services = coreServices(() => Promise.resolve({ '01k00000000000000000000040': 'token' }))
			const providers = createModelProviderProtocolProviders(services, { openAIResponses: neverCalledOpenAIResponsesProvider() })

			const result = await providers.preflightModel(openAIResponsesPreflightInput())

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'model-provider-secret-unresolved', secretId: '01k00000000000000000000041' },
					summary: 'OpenAI Responses model provider Secret value could not be resolved.',
				},
			})
		})

		it('loads active Model Provider Secrets for model Agent turns', async () => {
			const services = coreServicesWithSecrets(
				[secretRecord('01k00000000000000000000040', 'auth-ref'), secretRecord('01k00000000000000000000041', 'org-ref')],
				({ secrets }) =>
					Promise.resolve(Object.fromEntries(secrets.map((secret) => [secret.secretId, `${secret.valueRef}-plaintext`]))),
			)
			let observedAccess: ModelProviderProtocolAccess | null = null
			const providers = createModelProviderProtocolProviders(services, {
				openAIResponses: {
					resolveLanguageModel(input) {
						observedAccess = input.access
						return { ok: true, value: { languageModel: 'language-model', providerOptions: undefined } }
					},
				},
			})

			const result = await providers.resolveLanguageModel(openAIResponsesResolutionInput())

			expect(result).toEqual({ ok: true, value: { languageModel: 'language-model', providerOptions: undefined } })
			expect(observedAccess).toEqual({
				auth: { type: 'apiKey', plaintext: 'auth-ref-plaintext' },
				headers: [{ name: 'OpenAI-Organization', plaintext: 'org-ref-plaintext' }],
			})
		})
	})

	function openAIResponsesPreflightInput(): ModelProviderProtocolPreflightModelInput {
		return {
			model: openAIResponsesModel(),
			modelProvider: openAIResponsesModelProvider(),
			secrets: [
				{ secretId: '01k00000000000000000000040', valueRef: 'protected-ref-1' },
				{ secretId: '01k00000000000000000000041', valueRef: 'protected-ref-2' },
			],
		}
	}

	function openAIResponsesResolutionInput(): Omit<Extract<AISDKLanguageModelResolutionInput, { mode: 'agent-run' }>, 'access'> {
		return {
			mode: 'agent-run',
			model: openAIResponsesModel(),
			modelProvider: openAIResponsesModelProvider(),
			thinking: null,
		}
	}

	function openAIResponsesModel(): ModelProviderProtocolPreflightModelInput['model'] {
		return {
			id: '01k00000000000000000000024',
			providerId: '01k00000000000000000000027',
			name: 'GPT 5',
			providerModelId: 'gpt-5',
			providerOptions: null,
			capabilities: defaultModelCapabilities,
			pricing: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}

	function openAIResponsesModelProvider(): ModelProvider {
		return {
			id: '01k00000000000000000000027',
			name: 'OpenAI',
			source: { type: 'openai-responses' },
			auth: { value: { type: 'secret', secretId: '01k00000000000000000000040' } },
			headers: [{ name: 'OpenAI-Organization', value: { type: 'secret', secretId: '01k00000000000000000000041' } }],
			providerOptions: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}

	function neverCalledOpenAIResponsesProvider(): OpenAIResponsesModelProviderProtocolProvider {
		return {
			resolveLanguageModel() {
				throw new Error('OpenAI Responses provider should not be called.')
			},
		}
	}

	function coreServices(resolveSecretValues: CoreServices['secrets']['resolveSecretValues']): CoreServices {
		return {
			storage: unusedStorageService(),
			secrets: secretService(resolveSecretValues),
			sandbox: noopSandbox(),
			dispatcher: noopDispatcher(),
		}
	}

	function coreServicesWithSecrets(
		secrets: Array<{ id: Id; valueRef: string; archivePeriods: ArchivePeriod[] }>,
		resolveSecretValues: CoreServices['secrets']['resolveSecretValues'] = () => Promise.resolve({}),
	): CoreServices {
		return {
			storage: secretStorageService(secrets),
			secrets: secretService(resolveSecretValues),
			sandbox: noopSandbox(),
			dispatcher: noopDispatcher(),
		}
	}

	function noopSandbox(): CoreServices['sandbox'] {
		return {
			kind: 'consumer-managed',
			create: () => Promise.resolve(noopSandboxInstance()),
			find: () => Promise.resolve(noopSandboxInstance()),
		}
	}

	function noopSandboxInstance() {
		return {
			runCommand: () => Promise.resolve({ exitCode: 0, summary: 'Command completed.', stdout: null, stderr: null }),
			readFile: () => Promise.resolve(null),
			writeFile: () => Promise.resolve(),
			release: () => Promise.resolve({ summary: 'Sandbox released.' }),
		}
	}

	function secretRecord(
		id: Id,
		valueRef = 'protected-ref',
		archived = false,
	): { id: Id; valueRef: string; archivePeriods: ArchivePeriod[] } {
		return { id, valueRef, archivePeriods: archived ? [{ archived: openAIResponsesModel().created, unarchived: null }] : [] }
	}

	function secretStorageService(secrets: Array<{ id: Id; valueRef: string; archivePeriods: ArchivePeriod[] }>): CoreServices['storage'] {
		const byId = new Map(secrets.map((secret) => [secret.id, secret]))
		return {
			on: () => ({ one: () => ({ id: (id: Id) => ({ find: () => Promise.resolve(byId.get(id) ?? null) }) }) }),
			session: (run: () => unknown) => Promise.resolve(run()),
			resolve: () => Promise.reject(new Error('Storage resolve should not be called.')),
		} as never
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

	function noopDispatcher(): CoreServices['dispatcher'] {
		return {
			preflight: () => Promise.resolve({ ok: true }),
			request: () => Promise.resolve('dispatch-marker'),
			ready: () => {},
		}
	}
}
