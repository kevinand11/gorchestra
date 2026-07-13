import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedModelProviderPipe } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { listedModelProviders } from './model-provider-read-model'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecords } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedModelProviderPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetModelProviderQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('getModelProvider', inputPipe, (input) =>
		transactions.run(async ({ storage }) => {
			const provider = await getRequired('model-provider', storage, input.modelProviderId)
			if (!provider.ok) return provider

			const models = await listRecords('model', storage, {
				where: (filter, fields) => filter.eq(fields.providerId, provider.value.id),
				orderBy: [{ field: 'id', direction: 'desc' }],
			})
			return models.ok ? { ok: true, value: listedModelProviders([provider.value], models.value)[0]! } : models
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedModelProvider, seedSelectableModel } = await import('../utils/test-helpers')

	describe('getModelProvider query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.modelProviders.fail.get = true
			const query = createGetModelProviderQuery(options.transactions)

			const result = await query({ modelProviderId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getModelProvider' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the provider is missing', async () => {
			const result = await createGetModelProviderQuery(createTestCoreServices().transactions)({
				modelProviderId: '01k00000000000000000000032',
			})

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'model-provider', id: '01k00000000000000000000032' },
			})
		})

		it('returns one listed provider with only its nested Models', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000000032')
			seedSelectableModel(options.tx, '01k00000000000000000000024')
			options.tx.modelProviders.records.delete('01k00000000000000000000025')
			options.tx.models.records.set('01k00000000000000000000024', {
				...options.tx.models.records.get('01k00000000000000000000024')!,
				providerId: '01k00000000000000000000032',
			})
			seedModelProvider(options.tx, '01k00000000000000000000033')
			seedSelectableModel(options.tx, '01k00000000000000000100048')
			options.tx.modelProviders.records.delete('01k00000000000000000100051')
			options.tx.models.records.set('01k00000000000000000100048', {
				...options.tx.models.records.get('01k00000000000000000100048')!,
				providerId: '01k00000000000000000000033',
			})
			const query = createGetModelProviderQuery(options.transactions)

			const result = await query({ modelProviderId: '01k00000000000000000000032' })

			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.id).toBe('01k00000000000000000000032')
			expect(result.value.archived).toBe(false)
			expect(result.value.models).toEqual([expect.objectContaining({ id: '01k00000000000000000000024', archived: false })])
		})

		it('returns storage errors when nested Models cannot be listed', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000000032')
			options.tx.models.fail.list = true

			const result = await createGetModelProviderQuery(options.transactions)({ modelProviderId: '01k00000000000000000000032' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'model' } },
			})
		})
	})
}
