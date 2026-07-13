import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import { defaultModelCapabilities, type Model } from '../domain/model'
import { modelProviderProtocolForSource, type ModelProvider, type ModelProviderAccessValue } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage, ResolvableSecretValue } from '../services'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, isArchived } from '../utils/command-storage'
import { modelProviderProtocolPreflight } from '../utils/providers/model-provider-protocol'
import { validateModelThinkingCapabilityForProtocol } from '../utils/providers/model-provider-protocol/thinking'
import type { ModelProviderProtocolPreflightFailureReason } from '../utils/providers/model-provider-protocol/types'
import type { CoreRuntime } from '../utils/runtime'
import { validateActiveSecret } from '../utils/secrets'
import type { Result as CoreResult } from '../utils/types'

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

type ModelPreflightLocalError = InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError

export function createPreflightModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('preflightModel', preflightModelInputPipe, async (input) => {
		const readiness = await runtime.transactions.run<ModelPreflightReadiness, ModelPreflightLocalError>(async ({ storage }) => {
			const model = await getRequired('model', storage, input.modelId)
			if (!model.ok) return model

			const modelProvider = await getRequired('model-provider', storage, model.value.providerId)
			if (!modelProvider.ok) return modelProvider

			if (isArchived(model.value.archivePeriods)) {
				return {
					ok: true,
					value: {
						type: 'failed',
						modelProvider: modelProvider.value,
						reason: { type: 'model-archived', modelId: model.value.id },
					},
				}
			}
			if (isArchived(modelProvider.value.archivePeriods)) {
				return {
					ok: true,
					value: {
						type: 'failed',
						modelProvider: modelProvider.value,
						reason: { type: 'model-provider-archived', modelProviderId: modelProvider.value.id },
					},
				}
			}

			const thinkingValidation = validateModelThinkingCapabilityForProtocol(
				model.value,
				modelProviderProtocolForSource(modelProvider.value.source),
			)
			if (!thinkingValidation.ok) {
				return {
					ok: true,
					value: { type: 'failed', modelProvider: modelProvider.value, reason: thinkingValidation.error },
				}
			}

			const secretReadiness = await validateModelProviderSecrets(storage, modelProvider.value)
			if (!secretReadiness.ok) return secretReadiness
			return secretReadiness.value.type === 'failed'
				? { ok: true, value: secretReadiness.value }
				: {
						ok: true,
						value: {
							type: 'passed',
							model: model.value,
							modelProvider: modelProvider.value,
							secrets: secretReadiness.value.secrets,
						},
					}
		})
		if (!readiness.ok) return readiness
		if (readiness.value.type === 'failed') {
			const protocol = modelProviderProtocolForSource(readiness.value.modelProvider.source)
			return {
				ok: true,
				value: modelPreflightEvidence(false, modelProviderProtocolPreflight(protocol, readiness.value).summary),
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

async function validateModelProviderSecrets(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const auth = await validateModelProviderAuthSecret(storage, modelProvider)
	if (!auth.ok || auth.value.type === 'failed') return auth

	const headers = await validateModelProviderHeaderSecrets(storage, modelProvider)
	if (!headers.ok || headers.value.type === 'failed') return headers

	return {
		ok: true,
		value: {
			type: 'passed',
			secrets: [...new Map([...auth.value.secrets, ...headers.value.secrets].map((secret) => [secret.secretId, secret])).values()],
		},
	}
}

async function validateModelProviderAuthSecret(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	if (modelProvider.auth === null) return { ok: true, value: { type: 'passed', secrets: [] } }

	const secret = await validateActiveSecret(storage, secretIdFromAccessValue(modelProvider.auth.value))
	if (secret.ok) return { ok: true, value: { type: 'passed', secrets: [secretValueRef(secret.value)] } }

	const error = secret.error
	if (error.type === 'not-found' && error.resource === 'secret') {
		return {
			ok: true,
			value: { type: 'failed', modelProvider, reason: { type: 'model-provider-auth-secret-missing', secretId: error.id } },
		}
	}
	if (error.type === 'resource-archived') {
		return {
			ok: true,
			value: { type: 'failed', modelProvider, reason: { type: 'model-provider-auth-secret-inactive', secretId: error.id } },
		}
	}
	return { ok: false, error }
}

async function validateModelProviderHeaderSecrets(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<CoreResult<ModelPreflightFactReadiness, ModelPreflightLocalError>> {
	const secrets: ResolvableSecretValue[] = []
	for (const header of modelProvider.headers) {
		const secret = await validateActiveSecret(storage, secretIdFromAccessValue(header.value))
		if (secret.ok) {
			secrets.push(secretValueRef(secret.value))
			continue
		}

		const error = secret.error
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
		if (error.type === 'resource-archived') {
			return {
				ok: true,
				value: {
					type: 'failed',
					modelProvider,
					reason: { type: 'model-provider-header-secret-inactive', secretId: error.id, headerName: header.name },
				},
			}
		}
		return { ok: false, error }
	}
	return { ok: true, value: { type: 'passed', secrets } }
}

function secretIdFromAccessValue(value: ModelProviderAccessValue): string {
	switch (value.type) {
		case 'secret':
			return value.secretId
		default:
			throw new Error('Unexpected Model Provider access value.')
	}
}

function modelPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: 'model-preflight' }, passed, summary }
}

function secretValueRef(secret: { id: string; valueRef: string }): ResolvableSecretValue {
	return { secretId: secret.id, valueRef: secret.valueRef }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('preflightModel command', () => {
		it('validates input before reading storage', async () => {
			const command = createPreflightModelCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'preflightModel' } })
		})

		it('returns not-found when the target Model does not exist', async () => {
			const command = createPreflightModelCommand(createTestCoreRuntime())

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: '01k00000000000000000000024' } })
		})

		it('returns not-found when the referenced Model Provider does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.models.records.set('01k00000000000000000000024', modelRecord())
			const command = createPreflightModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'model-provider', id: '01k00000000000000000000027' },
			})
		})

		it('returns failed evidence when the Model is archived', async () => {
			const options = modelFixture({ modelArchived: true })
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses Model is archived.') })
		})

		it('returns failed evidence when the Model Provider is archived', async () => {
			const options = modelFixture({ providerArchived: true })
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses Model Provider is archived.') })
		})

		it('returns failed evidence when configured thinking support is unsupported by the Model Provider Protocol', async () => {
			const options = modelFixture()
			options.tx.modelProviders.records.set('01k00000000000000000000027', {
				...options.tx.modelProviders.records.get('01k00000000000000000000027')!,
				source: { type: 'google' },
			})
			options.tx.models.records.set('01k00000000000000000000024', {
				...options.tx.models.records.get('01k00000000000000000000024')!,
				capabilities: { ...defaultModelCapabilities, thinking: { supportedLevels: ['xhigh'] } },
			})
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({
				ok: true,
				value: modelPreflightEvidence(false, 'Google Generative AI Model thinking level xhigh is unavailable.'),
			})
		})

		it('returns failed evidence when the auth Secret is missing', async () => {
			const options = modelFixture()
			seedSecret(options.tx, '01k00000000000000000000041')
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({
				ok: true,
				value: modelPreflightEvidence(false, 'OpenAI Responses model provider auth Secret is missing.'),
			})
		})

		it('returns failed evidence when a header Secret is inactive', async () => {
			const options = modelFixture()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041', true)
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({
				ok: true,
				value: modelPreflightEvidence(false, 'OpenAI Responses model provider header Secret is not active.'),
			})
		})

		it('calls Model Provider Protocol providers outside the storage transaction and returns passing evidence', async () => {
			const options = modelFixture()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			options.secrets.resolveSecretValues = () =>
				Promise.resolve({ '01k00000000000000000000040': 'token', '01k00000000000000000000041': 'org-1' })
			let providerTransactionCalls: number | null = null
			const providers = {
				sourceControl: createTestCoreRuntime(options).providers.sourceControl,
				modelProviderProtocols: {
					preflightModel() {
						providerTransactionCalls = options.transactionCalls()
						return Promise.resolve({
							ok: true as const,
							value: { type: 'passed' as const, summary: 'OpenAI Responses model preflight passed.' },
						})
					},
					resolveLanguageModel: () => Promise.reject(new Error('unused')),
				},
			}
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(true, 'OpenAI Responses model preflight passed.') })
			expect(providerTransactionCalls).toBe(1)
		})

		it('maps provider failures to failed evidence', async () => {
			const options = modelFixture()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			options.secrets.resolveSecretValues = () =>
				Promise.resolve({ '01k00000000000000000000040': 'token', '01k00000000000000000000041': 'org-1' })
			const providers = {
				sourceControl: createTestCoreRuntime(options).providers.sourceControl,
				modelProviderProtocols: {
					preflightModel: () =>
						Promise.resolve({
							ok: true as const,
							value: {
								type: 'failed' as const,
								reason: { type: 'provider-model-not-found' as const },
								summary: 'OpenAI Responses model was not found.',
							},
						}),
					resolveLanguageModel: () => Promise.reject(new Error('unused')),
				},
			}
			const command = createPreflightModelCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toEqual({ ok: true, value: modelPreflightEvidence(false, 'OpenAI Responses model was not found.') })
		})

		it('returns invalid Core Service Output from Secret value resolution', async () => {
			const options = modelFixture()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			options.secrets.resolveSecretValues = () =>
				Promise.resolve({ '01k00000000000000000000040': 1, '01k00000000000000000000041': 'org-1' } as never)
			const command = createPreflightModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
			})
		})
	})

	function modelFixture(options: { modelArchived?: boolean; providerArchived?: boolean } = {}) {
		const services = createTestCoreServices()
		services.tx.models.records.set('01k00000000000000000000024', modelRecord(options.modelArchived))
		services.tx.modelProviders.records.set('01k00000000000000000000027', modelProviderRecord(options.providerArchived))
		return services
	}

	function modelRecord(archived = false): Model {
		return {
			id: '01k00000000000000000000024',
			providerId: '01k00000000000000000000027',
			name: 'GPT 5',
			providerModelId: 'gpt-5',
			providerOptions: null,
			capabilities: defaultModelCapabilities,
			pricing: null,
			created: stamp,
			updated: null,
			archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function modelProviderRecord(archived = false): ModelProvider {
		return {
			id: '01k00000000000000000000027',
			name: 'OpenAI',
			source: { type: 'openai-responses' },
			auth: { value: { type: 'secret', secretId: '01k00000000000000000000040' } },
			headers: [{ name: 'OpenAI-Organization', value: { type: 'secret', secretId: '01k00000000000000000000041' } }],
			providerOptions: null,
			created: stamp,
			updated: null,
			archivePeriods: archived ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function neverCalledProviders(options: ReturnType<typeof createTestCoreServices>) {
		return {
			sourceControl: createTestCoreRuntime(options).providers.sourceControl,
			modelProviderProtocols: {
				preflightModel: neverCalledOpenAIResponsesProvider,
				resolveLanguageModel: () => Promise.reject(new Error('unused')),
			},
		}
	}

	function neverCalledOpenAIResponsesProvider() {
		return Promise.reject(new Error('OpenAI Responses provider should not be called.'))
	}
}
