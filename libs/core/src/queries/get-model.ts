import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { defaultModelCapabilities } from '../domain/model'
import { modelDetailsPipe } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { listedModel, modelProviderSummary } from './model-provider-read-model'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = modelDetailsPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetModelQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('getModel', inputPipe, (input) =>
		transactions.run(async ({ storage }) => {
			const model = await getRequired('model', storage, input.modelId)
			if (!model.ok) return model

			const provider = await getRequired('model-provider', storage, model.value.providerId)
			return provider.ok
				? { ok: true, value: { ...listedModel(model.value, provider.value), provider: modelProviderSummary(provider.value) } }
				: provider
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedModelProvider, seedSelectableModel, stamp } = await import('../utils/test-helpers')

	describe('getModel query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.models.fail.get = true
			const query = createGetModelQuery(options.transactions)

			const result = await query({ modelId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getModel' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Model does not exist', async () => {
			const result = await createGetModelQuery(createTestCoreServices().transactions)({ modelId: '01k00000000000000000000024' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model', id: '01k00000000000000000000024' } })
		})

		it('returns not-found when the Model Provider does not exist', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			options.tx.modelProviders.records.delete('01k00000000000000000050024')
			const query = createGetModelQuery(options.transactions)

			const result = await query({ modelId: '01k00000000000000000000024' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'model-provider', id: '01k00000000000000000050024' },
			})
		})

		it('returns Model details with Provider summary and derived archive state', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000000032', true)
			options.tx.modelProviders.records.set('01k00000000000000000000032', {
				...options.tx.modelProviders.records.get('01k00000000000000000000032')!,
				name: 'Provider One',
				source: { type: 'openai-responses' },
			})
			options.tx.models.records.set('01k00000000000000000000024', {
				id: '01k00000000000000000000024',
				providerId: '01k00000000000000000000032',
				name: 'Model One',
				providerModelId: 'provider-model-1',
				providerOptions: { serviceTier: 'flex' },
				capabilities: { ...defaultModelCapabilities, thinking: { supportedLevels: ['high'] } },
				pricing: null,
				created: stamp,
				updated: null,
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const query = createGetModelQuery(options.transactions)

			const result = await query({ modelId: '01k00000000000000000000024' })

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000024',
					providerId: '01k00000000000000000000032',
					name: 'Model One',
					providerModelId: 'provider-model-1',
					providerOptions: { serviceTier: 'flex' },
					capabilities: { ...defaultModelCapabilities, thinking: { supportedLevels: ['high'] } },
					pricing: null,
					availableThinkingLevels: ['none', 'high'],
					created: stamp,
					updated: null,
					archived: true,
					provider: {
						id: '01k00000000000000000000032',
						name: 'Provider One',
						source: { type: 'openai-responses' },
						protocol: 'openai-responses',
						archived: true,
						configurableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
					},
				},
			})
		})

		it('returns storage errors when Model reads fail', async () => {
			const options = createTestCoreServices()
			options.storage.on = () => {
				throw new Error('get failed')
			}
			const query = createGetModelQuery(options.transactions)

			const result = await query({ modelId: '01k00000000000000000000024' })

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'storage-operation-failed',
					operation: { type: 'get', resource: 'model', id: '01k00000000000000000000024' },
				},
			})
		})
	})
}
