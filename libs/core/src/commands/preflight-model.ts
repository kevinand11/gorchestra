import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import { defaultModelCapabilities, type Model } from '../domain/model'
import type { ModelProvider, ModelProviderHeader } from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import { modelProviderProtocolPreflight } from '../providers/model-provider-protocol'
import type { ModelProviderProtocolPreflightFailureReason } from '../providers/model-provider-protocol/types'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorage, ResolvableSecretValue } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, isArchived, validateActiveSecret, withTransaction } from './utils/storage'

const preflightModelInputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof preflightModelInputPipe>

export type Result = ValidationEvidence

export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type ModelPreflightReadiness =
	| { type: 'passed'; model: Model; modelProvider: ModelProvider; secrets: ResolvableSecretValue[] }
	| { type: 'failed'; modelProvider: ModelProvider; reason: ModelProviderProtocolPreflightFailureReason }

type ModelPreflightFactReadiness =
	| { type: 'passed'; secrets: ResolvableSecretValue[] }
	| { type: 'failed'; modelProvider: ModelProvider; reason: ModelProviderProtocolPreflightFailureReason }

type ModelPreflightStorageFacts = { model: Model; modelProvider: ModelProvider }

type ModelPreflightLocalError = InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError

export function createPreflightModelCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('preflightModel', preflightModelInputPipe, async (input) => {
		const readiness = await readModelPreflightReadiness(options, input)
		if (!readiness.ok) return readiness
		if (readiness.value.type === 'failed') {
			return {
				ok: true,
				value: modelPreflightEvidence(
					false,
					modelProviderProtocolPreflight(readiness.value.modelProvider.protocol, readiness.value).summary,
				),
			}
		}

		const providerPreflight = await runtime.providers.modelProviderProtocols.preflightModel({
			model: readiness.value.model,
			modelProvider: readiness.value.modelProvider,
			secrets: readiness.value.secrets,
		})
		if (!providerPreflight.ok) return providerPreflight

		return {
			ok: true,
			value: modelPreflightEvidence(providerPreflight.value.type === 'passed', providerPreflight.value.summary),
		}
	})
}

function readModelPreflightReadiness(
	options: CoreServices,
	input: Input,
): Promise<CoreResult<ModelPreflightReadiness, ModelPreflightLocalError>> {
	return withTransaction(options, (storage) => readModelPreflightReadinessFromStorage(storage, input.modelId))
}

async function readModelPreflightReadinessFromStorage(
	storage: CoreStorage,
	modelId: string,
): Promise<CoreResult<ModelPreflightReadiness, ModelPreflightLocalError>> {
	const facts = await readModelPreflightStorageFacts(storage, modelId)
	if (!facts.ok) return facts

	const activeFacts = await validateActiveModelFacts(storage, facts.value.model, facts.value.modelProvider)
	if (!activeFacts.ok) return activeFacts
	if (activeFacts.value.type === 'failed') return { ok: true, value: activeFacts.value }

	return { ok: true, value: { type: 'passed', ...facts.value, secrets: activeFacts.value.secrets } }
}

async function readModelPreflightStorageFacts(
	storage: CoreStorage,
	modelId: string,
): Promise<CoreResult<ModelPreflightStorageFacts, ModelPreflightLocalError>> {
	const model = await getRequired('model', storage, modelId)
	if (!model.ok) return model

	const modelProvider = await getRequired('model-provider', storage, model.value.providerId)
	return modelProvider.ok ? { ok: true, value: { model: model.value, modelProvider: modelProvider.value } } : modelProvider
}

async function validateActiveModelFacts(
	storage: CoreStorage,
	model: Model,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const archivalReadiness = modelArchivalReadiness(model, modelProvider)
	return archivalReadiness.type === 'failed' ? { ok: true, value: archivalReadiness } : validateModelSecrets(storage, modelProvider)
}

async function validateModelSecrets(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const authSecret = await validateAuthSecret(storage, modelProvider)
	return authSecret.ok && authSecret.value.type === 'passed'
		? validateModelHeaderSecrets(storage, modelProvider, authSecret.value.secrets)
		: authSecret
}

async function validateModelHeaderSecrets(
	storage: CoreStorage,
	modelProvider: ModelProvider,
	authSecrets: ResolvableSecretValue[],
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const headerSecrets = await validateHeaderSecrets(storage, modelProvider)
	return combineModelSecrets(authSecrets, headerSecrets)
}

function combineModelSecrets(
	authSecrets: ResolvableSecretValue[],
	headerSecrets: CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>,
): CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError> {
	return headerSecrets.ok && headerSecrets.value.type === 'passed'
		? { ok: true, value: { type: 'passed', secrets: uniqueSecrets([...authSecrets, ...headerSecrets.value.secrets]) } }
		: headerSecrets
}

function modelArchivalReadiness(model: Model, modelProvider: ModelProvider): ModelPreflightFactReadiness {
	if (isArchived(model.archivePeriods)) return { type: 'failed', modelProvider, reason: { type: 'model-archived', modelId: model.id } }

	return isArchived(modelProvider.archivePeriods)
		? { type: 'failed', modelProvider, reason: { type: 'model-provider-archived', modelProviderId: modelProvider.id } }
		: { type: 'passed', secrets: [] }
}

async function validateAuthSecret(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	if (modelProvider.auth === null) return { ok: true, value: { type: 'passed', secrets: [] } }

	const secret = await validateActiveSecret(storage, modelProvider.auth.secretId)
	return secret.ok
		? { ok: true, value: { type: 'passed', secrets: [secretValueRef(secret.value)] } }
		: mapAuthSecretFailure(modelProvider, secret.error)
}

async function validateHeaderSecrets(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const secrets: ResolvableSecretValue[] = []
	for (const header of modelProvider.headers) {
		const secret = await validateActiveSecret(storage, header.valueSecretId)
		if (!secret.ok) return mapHeaderSecretFailure(modelProvider, header, secret.error)
		secrets.push(secretValueRef(secret.value))
	}

	return { ok: true, value: { type: 'passed', secrets } }
}

function mapAuthSecretFailure(
	modelProvider: ModelProvider,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return {
			ok: true,
			value: { type: 'failed', modelProvider, reason: { type: 'model-provider-auth-secret-missing', secretId: error.id } },
		}
	}
	if (error.type === 'secret-not-active') {
		return {
			ok: true,
			value: {
				type: 'failed',
				modelProvider,
				reason: { type: 'model-provider-auth-secret-inactive', secretId: error.secretId },
			},
		}
	}

	return { ok: false, error }
}

function mapHeaderSecretFailure(
	modelProvider: ModelProvider,
	header: ModelProviderHeader,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return {
			ok: true,
			value: {
				type: 'failed',
				modelProvider,
				reason: { type: 'model-provider-header-secret-missing', secretId: error.id, headerName: header.name },
			},
		}
	}
	if (error.type === 'secret-not-active') {
		return {
			ok: true,
			value: {
				type: 'failed',
				modelProvider,
				reason: { type: 'model-provider-header-secret-inactive', secretId: error.secretId, headerName: header.name },
			},
		}
	}

	return { ok: false, error }
}

function modelPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: 'model-preflight' }, passed, summary }
}

function uniqueSecrets(secrets: ResolvableSecretValue[]): ResolvableSecretValue[] {
	return [...new Map(secrets.map((secret) => [secret.secretId, secret])).values()]
}

function secretValueRef(secret: { id: string; valueRef: string }): ResolvableSecretValue {
	return { secretId: secret.id, valueRef: secret.valueRef }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createModelProviderProtocolProviders } = await import('../providers/model-provider-protocol')
	const { context, createTestCoreRuntime, createTestCoreServices, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('preflightModel command', () => {
		it('validates input before reading storage', async () => {
			const command = createPreflightModelCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'preflightModel' } })
		})

		it('returns not-found when the target Model does not exist', async () => {
			const command = createPreflightModelCommand(createTestCoreRuntime())

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: 'model-1' } })
		})

		it('returns not-found when the referenced Model Provider does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.models.records.set('model-1', modelRecord())
			const command = createPreflightModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model-provider', id: 'model-provider-1' } })
		})

		it('returns failed evidence when the Model is archived', async () => {
			const options = modelFixture({ modelArchived: true })
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses Model is archived.') })
		})

		it('returns failed evidence when the Model Provider is archived', async () => {
			const options = modelFixture({ providerArchived: true })
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses Model Provider is archived.') })
		})

		it('returns failed evidence when the auth Secret is missing', async () => {
			const options = modelFixture()
			seedSecret(options.tx, 'secret-2')
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: modelPreflightEvidence(false, 'OpenAI Responses model provider auth Secret is missing.'),
			})
		})

		it('returns failed evidence when a header Secret is inactive', async () => {
			const options = modelFixture()
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2', true)
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: modelPreflightEvidence(false, 'OpenAI Responses model provider header Secret is not active.'),
			})
		})

		it('calls Model Provider Protocol providers outside the storage transaction and returns passing evidence', async () => {
			const options = modelFixture()
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 'token', 'secret-2': 'org-1' })
			let providerTransactionCalls: number | null = null
			const providers = {
				sourceControl: createTestCoreRuntime(options).providers.sourceControl,
				modelProviderProtocols: createModelProviderProtocolProviders(options, {
					openAIResponses: {
						preflightModel() {
							providerTransactionCalls = options.transactionCalls()
							return Promise.resolve({ type: 'passed' })
						},
					},
				}),
			}
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(true, 'OpenAI Responses model preflight passed.') })
			expect(providerTransactionCalls).toBe(1)
		})

		it('maps provider failures to failed evidence', async () => {
			const options = modelFixture()
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 'token', 'secret-2': 'org-1' })
			const providers = {
				sourceControl: createTestCoreRuntime(options).providers.sourceControl,
				modelProviderProtocols: createModelProviderProtocolProviders(options, {
					openAIResponses: {
						preflightModel: () => Promise.resolve({ type: 'failed', reason: { type: 'provider-model-not-found' } }),
					},
				}),
			}
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses model was not found.') })
		})

		it('returns invalid Core Service Output from Secret value resolution', async () => {
			const options = modelFixture()
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 1, 'secret-2': 'org-1' } as never)
			const command = createPreflightModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
			})
		})
	})

	function modelFixture(options: { modelArchived?: boolean; providerArchived?: boolean } = {}) {
		const services = createTestCoreServices()
		services.tx.models.records.set('model-1', modelRecord(options.modelArchived))
		services.tx.modelProviders.records.set('model-provider-1', modelProviderRecord(options.providerArchived))
		return services
	}

	function modelRecord(archived = false): Model {
		return {
			id: 'model-1',
			providerId: 'model-provider-1',
			name: 'GPT 5',
			providerModelId: 'gpt-5',
			capabilities: defaultModelCapabilities,
			pricing: null,
			created: stamp,
			updated: null,
			archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function modelProviderRecord(archived = false): ModelProvider {
		return {
			id: 'model-provider-1',
			name: 'OpenAI',
			protocol: { type: 'openai-responses' },
			baseUrl: 'https://api.openai.com/v1',
			auth: { type: 'apiKey', secretId: 'secret-1' },
			headers: [{ name: 'OpenAI-Organization', valueSecretId: 'secret-2' }],
			created: stamp,
			updated: null,
			archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function neverCalledProviders(options: ReturnType<typeof createTestCoreServices>) {
		return {
			sourceControl: createTestCoreRuntime(options).providers.sourceControl,
			modelProviderProtocols: createModelProviderProtocolProviders(options, {
				openAIResponses: neverCalledOpenAIResponsesProvider(),
			}),
		}
	}

	function neverCalledOpenAIResponsesProvider() {
		return {
			preflightModel() {
				throw new Error('OpenAI Responses provider should not be called.')
			},
		}
	}
}
