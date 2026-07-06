import { v, type PipeInput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, jsonObjectPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { defaultModelCapabilities, modelCapabilitiesPipe, modelTokenPricingPipe, type Model } from '../domain/model'
import { modelProviderProtocolForSource } from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { validateModelThinkingCapabilityForProtocol } from '../providers/model-provider-protocol/thinking'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, updateRecordValue, withAuditStampTransaction } from './utils/storage'

const updateModelInputPipe = v.object({
	modelId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerOptions: v.nullable(jsonObjectPipe),
	capabilities: modelCapabilitiesPipe,
	pricing: v.nullable(modelTokenPricingPipe),
})
export type Input = PipeInput<typeof updateModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ModelThinkingLevelUnavailableError
	| StorageOperationFailedError
	| ResourceNotFoundError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateModel', updateModelInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
				const existing = await getRequired('model', storage, input.modelId)
				if (!existing.ok) return existing

				const provider = await getRequired('model-provider', storage, existing.value.providerId)
				if (!provider.ok) return provider

				const updated = {
					...existing.value,
					name: input.name,
					providerOptions: input.providerOptions,
					capabilities: input.capabilities,
					pricing: input.pricing,
					updated: stamp,
				}
				const protocol = modelProviderProtocolForSource(provider.value.source)
				const capabilityValidation = validateModelThinkingCapabilityForProtocol(updated, protocol)
				if (!capabilityValidation.ok) return capabilityValidation

				return updateRecordValue('model', storage, input.modelId, updated)
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('updateModel command', () => {
		it('updates Model editable metadata', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			const command = createUpdateModelCommand(createTestCoreRuntime(options))
			const capabilities = { ...defaultModelCapabilities, maxOutputTokens: 8192 }
			const pricing = { unit: 'micro-usd-per-million-tokens' as const, input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }

			const result = await command(
				{
					modelId: '01k00000000000000000000024',
					name: ' Updated ',
					providerOptions: { serviceTier: 'flex' },
					capabilities,
					pricing,
				},
				context,
			)

			expect(result).toMatchObject({
				ok: true,
				value: {
					id: '01k00000000000000000000024',
					name: 'Updated',
					providerOptions: { serviceTier: 'flex' },
					capabilities,
					pricing,
					updated: localStamp(),
				},
			})
		})

		it('rejects Model thinking support that the Model Provider Protocol cannot map', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			options.tx.modelProviders.records.set('01k00000000000000000050024', {
				...options.tx.modelProviders.records.get('01k00000000000000000050024')!,
				source: { type: 'google' },
			})
			const command = createUpdateModelCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					modelId: '01k00000000000000000000024',
					name: 'Gemini',
					providerOptions: null,
					capabilities: { ...defaultModelCapabilities, thinking: { supportedLevels: ['xhigh'] } },
					pricing: null,
				},
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'model-thinking-level-unavailable',
					modelId: '01k00000000000000000000024',
					thinkingLevel: 'xhigh',
					reason: { type: 'provider-thinking-level-unsupported', protocol: 'google-generative-ai' },
				},
			})
		})
	})
}
