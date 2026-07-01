import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedModelProviderPipe } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listedModelProviders } from './model-provider-read-model'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedModelProviderPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetModelProviderQuery(options: CoreServices): Operation {
	return buildQueryHandler('getModelProvider', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const provider = await getRequired('model-provider', storage, input.modelProviderId)
			if (!provider.ok) return provider

			const models = await listRecords('model', storage, {
				where: (filter, fields) => filter.eq(fields.providerId, provider.value.id),
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
			const query = createGetModelProviderQuery(options)

			const result = await query({ modelProviderId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getModelProvider' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the provider is missing', async () => {
			const result = await createGetModelProviderQuery(createTestCoreServices())({ modelProviderId: 'provider-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'model-provider', id: 'provider-1' } })
		})

		it('returns one listed provider with only its nested Models', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, 'provider-1')
			seedSelectableModel(options.tx, 'model-1')
			options.tx.modelProviders.records.delete('model-1-provider')
			options.tx.models.records.set('model-1', { ...options.tx.models.records.get('model-1')!, providerId: 'provider-1' })
			seedModelProvider(options.tx, 'provider-2')
			seedSelectableModel(options.tx, 'model-other')
			options.tx.modelProviders.records.delete('model-other-provider')
			options.tx.models.records.set('model-other', { ...options.tx.models.records.get('model-other')!, providerId: 'provider-2' })
			const query = createGetModelProviderQuery(options)

			const result = await query({ modelProviderId: 'provider-1' })

			expect(result.ok).toBe(true)
			if (!result.ok) return
			expect(result.value.id).toBe('provider-1')
			expect(result.value.archived).toBe(false)
			expect(result.value.models).toEqual([expect.objectContaining({ id: 'model-1', archived: false })])
		})

		it('returns storage errors when nested Models cannot be listed', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, 'provider-1')
			options.tx.models.fail.list = true

			const result = await createGetModelProviderQuery(options)({ modelProviderId: 'provider-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'model' } },
			})
		})
	})
}
