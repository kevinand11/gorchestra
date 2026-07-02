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
	ModelAgentTurnError,
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
import type { ArchivePeriod, Id } from '../../domain/commons'
import type { ModelProvider, ModelProviderHeader, ModelProviderProtocol, ModelProviderProtocolType } from '../../domain/model-provider'
import type { Secret } from '../../domain/secret'
import type { CoreStorageOperation } from '../../errors'
import {
	resolvedSecretValuesPipe,
	type CoreServices,
	type CoreStorage,
	type ResolvableSecretValue,
	type ResolvedSecretValues,
} from '../../services'
import { secretSchema } from '../../storage/schemas'
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
): Promise<Result<ModelAgentTurnOutput, ModelAgentTurnError>> {
	const access = await resolveModelProviderProtocolAccessFromStorage(services, input.modelProvider)
	if (!access.ok) return access
	if (!isProtocolAccess(access.value)) return { ok: true, value: modelAccessFailureOutput(access.value) }

	const concreteProvider = concreteProviderForProtocol(concrete, input.modelProvider.protocol)
	return concreteProvider.runModelAgentTurn === undefined
		? { ok: true, value: agentTurnNotImplementedOutput(input.modelProvider.protocol) }
		: {
				ok: true,
				value: await concreteProvider.runModelAgentTurn({
					...input,
					modelProvider: input.modelProvider as never,
					access: access.value,
				}),
			}
}

function modelAccessFailureOutput(preflight: ModelProviderProtocolPreflight): ModelAgentTurnOutput {
	return { outcome: { type: 'error', message: null, summary: preflight.summary } }
}

function agentTurnNotImplementedOutput(protocol: ModelProviderProtocol): ModelAgentTurnOutput {
	return { outcome: { type: 'error', message: null, summary: `${protocol.type} agent turns are not implemented.` } }
}

function concreteProviderForProtocol(concrete: Required<ModelProviderProtocolProviderImplementations>, protocol: ModelProviderProtocol) {
	return {
		'anthropic-messages': concrete.anthropicMessages,
		'openai-responses': concrete.openAIResponses,
		'openai-completions': concrete.openAICompletions,
		'google-generative-ai': concrete.googleGenerativeAI,
	}[protocol.type]
}

function concretePreflight(
	concrete: Required<ModelProviderProtocolProviderImplementations>,
	input: ModelProviderProtocolPreflightModelInput,
	access: ModelProviderProtocolAccess,
) {
	return concretePreflightDispatch(concrete, input, access)[input.modelProvider.protocol.type]()
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
type ModelProviderSecretReadiness =
	| { type: 'passed'; secrets: ResolvableSecretValue[] }
	| { type: 'failed'; preflight: ModelProviderProtocolPreflight }

type ModelProviderSecretReadinessError = ModelAgentTurnError

async function resolveModelProviderProtocolAccessFromStorage(
	services: CoreServices,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderProtocolAccess | ModelProviderProtocolPreflight, ModelAgentTurnError>> {
	const secrets = await readModelProviderSecretReadiness(services, modelProvider)
	if (!secrets.ok) return secrets
	return secrets.value.type === 'failed'
		? { ok: true, value: secrets.value.preflight }
		: resolveModelProviderProtocolAccess(services, modelProvider, secrets.value.secrets)
}

async function readModelProviderSecretReadiness(
	services: CoreServices,
	modelProvider: ModelProvider,
): Promise<Result<ModelProviderSecretReadiness, ModelProviderSecretReadinessError>> {
	try {
		return await services.storage.session(() => readModelProviderSecretReadinessFromStorage(services.storage, modelProvider))
	} catch (error) {
		return storageFailure({ type: 'transaction', cause: error })
	}
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
		: readSecretReadiness(storage, modelProvider, modelProvider.auth.secretId, {
				missing: { type: 'model-provider-auth-secret-missing', secretId: modelProvider.auth.secretId },
				inactive: { type: 'model-provider-auth-secret-inactive', secretId: modelProvider.auth.secretId },
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
	return readSecretReadiness(storage, modelProvider, header.valueSecretId, {
		missing: { type: 'model-provider-header-secret-missing', secretId: header.valueSecretId, headerName: header.name },
		inactive: { type: 'model-provider-header-secret-inactive', secretId: header.valueSecretId, headerName: header.name },
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
	return { type: 'failed', preflight: modelProviderProtocolPreflight(modelProvider.protocol, { type: 'failed', reason }) }
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

function protocolProviderInput<Protocol extends ModelProviderProtocolType>(
	input: ModelProviderProtocolPreflightModelInput,
	access: ModelProviderProtocolAccess,
	protocol: Protocol,
): ModelProviderProtocolProviderPreflightModelInput<Protocol> {
	return {
		...input,
		modelProvider: { ...input.modelProvider, protocol: { type: protocol } },
		access,
	} as ModelProviderProtocolProviderPreflightModelInput<Protocol>
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

const protocolDisplayNames: Record<ModelProviderProtocolType, string> = {
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
	return protocolDisplayNames[protocol.type]
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
	const { defaultModelCapabilities } = await import('../../domain/model')

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

		it('loads active Model Provider Secrets for model Agent turns', async () => {
			const services = coreServicesWithSecrets(
				[secretRecord('secret-1', 'auth-ref'), secretRecord('secret-2', 'org-ref')],
				({ secrets }) =>
					Promise.resolve(Object.fromEntries(secrets.map((secret) => [secret.secretId, `${secret.valueRef}-plaintext`]))),
			)
			let observedAccess: ModelProviderProtocolAccess | null = null
			const providers = createModelProviderProtocolProviders(services, {
				openAIResponses: {
					preflightModel: () => Promise.resolve({ type: 'passed' }),
					runModelAgentTurn(input) {
						observedAccess = input.access
						return Promise.resolve(stopTurnOutput())
					},
				},
			})

			const result = await providers.runModelAgentTurn(openAIResponsesTurnInput())

			expect(result).toEqual({ ok: true, value: stopTurnOutput() })
			expect(observedAccess).toEqual({
				auth: { type: 'apiKey', plaintext: 'auth-ref-plaintext' },
				headers: [{ name: 'OpenAI-Organization', plaintext: 'org-ref-plaintext' }],
			})
		})

		it('returns model error outcomes for missing model Agent turn Secrets', async () => {
			const providers = createModelProviderProtocolProviders(coreServicesWithSecrets([]), {
				openAIResponses: neverCalledOpenAIResponsesProvider(),
			})

			const result = await providers.runModelAgentTurn(openAIResponsesTurnInput())

			expect(result).toEqual({
				ok: true,
				value: {
					outcome: {
						type: 'error',
						message: null,
						summary: 'OpenAI Responses model provider auth Secret is missing.',
					},
				},
			})
		})

		it('returns model error outcomes for archived model Agent turn Secrets', async () => {
			const services = coreServicesWithSecrets([secretRecord('secret-1'), secretRecord('secret-2', 'protected-ref', true)])
			const providers = createModelProviderProtocolProviders(services, { openAIResponses: neverCalledOpenAIResponsesProvider() })

			const result = await providers.runModelAgentTurn(openAIResponsesTurnInput())

			expect(result).toEqual({
				ok: true,
				value: {
					outcome: {
						type: 'error',
						message: null,
						summary: 'OpenAI Responses model provider header Secret is not active.',
					},
				},
			})
		})

		it('returns invalid Core Service output for malformed resolved Secret values during model Agent turns', async () => {
			const services = coreServicesWithSecrets([secretRecord('secret-1'), secretRecord('secret-2')], () =>
				Promise.resolve({ 'secret-1': 123 } as never),
			)
			const providers = createModelProviderProtocolProviders(services, { openAIResponses: neverCalledOpenAIResponsesProvider() })

			const result = await providers.runModelAgentTurn(openAIResponsesTurnInput())

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
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
			model: openAIResponsesModel(),
			modelProvider: openAIResponsesModelProvider(),
			secrets: [
				{ secretId: 'secret-1', valueRef: 'protected-ref-1' },
				{ secretId: 'secret-2', valueRef: 'protected-ref-2' },
			],
		}
	}

	function openAIResponsesTurnInput(): ModelAgentTurnInput {
		return {
			model: openAIResponsesModel(),
			modelProvider: openAIResponsesModelProvider(),
			messages: [],
			tools: [],
			signal: new AbortController().signal,
			onDelta: () => undefined,
		}
	}

	function openAIResponsesModel(): ModelProviderProtocolPreflightModelInput['model'] {
		return {
			id: 'model-1',
			providerId: 'model-provider-1',
			name: 'GPT 5',
			providerModelId: 'gpt-5',
			capabilities: defaultModelCapabilities,
			pricing: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}

	function stopTurnOutput(): ModelAgentTurnOutput {
		return { outcome: { type: 'stop', message: { content: [], usage: null, providerResponseRef: null } } }
	}

	function openAIResponsesModelProvider(): ModelProvider {
		return {
			id: 'model-provider-1',
			name: 'OpenAI',
			protocol: { type: 'openai-responses' },
			baseUrl: 'https://api.openai.com/v1',
			auth: { type: 'apiKey', secretId: 'secret-1' },
			headers: [{ name: 'OpenAI-Organization', valueSecretId: 'secret-2' }],
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}

	function openAICompletionsModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: { type: 'openai-completions' } }
	}

	function anthropicModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: { type: 'anthropic-messages' }, auth: null, headers: [] }
	}

	function googleGenerativeAIModelProvider(): ModelProvider {
		return { ...openAIResponsesModelProvider(), protocol: { type: 'google-generative-ai' }, auth: null, headers: [] }
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
			sandbox: { preflight: () => Promise.resolve({ ok: true }) },
			dispatcher: noopDispatcher(),
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
			requestDispatch: () => Promise.resolve(),
		}
	}
}
