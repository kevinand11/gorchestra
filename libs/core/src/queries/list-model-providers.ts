import { v, type PipeOutput } from 'valleyed'

import { listedModelProviderPipe } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listedModelProviders } from './model-provider-read-model'
import { listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(listedModelProviderPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListModelProvidersQuery(options: CoreServices): Operation {
	return buildQueryHandler('listModelProviders', inputPipe, () =>
		withTransaction(options, async (storage) => {
			const providers = await listRecords('model-provider', storage)
			if (!providers.ok) return providers

			const models = await listRecords('model', storage)
			return models.ok ? { ok: true, value: listedModelProviders(providers.value, models.value) } : models
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedModelProvider, seedSelectableModel, stamp } = await import('../utils/test-helpers')

	describe('listModelProviders query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.modelProviders.fail.list = true
			const query = createListModelProvidersQuery(options)

			const result = await query(null as unknown as Input)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listModelProviders' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns an empty Model Provider list for an empty Portfolio', async () => {
			const query = createListModelProvidersQuery(createTestCoreServices())

			const result = await query({})

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('lists providers with nested Models in creation order and archive state', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, 'provider-b')
			seedModelProvider(options.tx, 'provider-a', true)
			options.tx.modelProviders.records.set('provider-a', {
				...options.tx.modelProviders.records.get('provider-a')!,
				name: 'Provider A',
				created: { origin: 'imported', at: '2026-06-09T00:00:00.000Z' },
			})
			options.tx.modelProviders.records.set('provider-b', {
				...options.tx.modelProviders.records.get('provider-b')!,
				name: 'Provider B',
				created: { origin: 'imported', at: '2026-06-10T00:00:00.000Z' },
			})
			seedSelectableModel(options.tx, 'model-a')
			options.tx.modelProviders.records.delete('model-a-provider')
			options.tx.models.records.set('model-a', {
				...options.tx.models.records.get('model-a')!,
				providerId: 'provider-a',
				name: 'Model A',
				created: { origin: 'imported', at: '2026-06-09T00:00:00.000Z' },
			})
			seedSelectableModel(options.tx, 'model-b', { modelArchived: true })
			options.tx.modelProviders.records.delete('model-b-provider')
			options.tx.models.records.set('model-b', {
				...options.tx.models.records.get('model-b')!,
				providerId: 'provider-a',
				name: 'Model B',
				created: { origin: 'imported', at: '2026-06-10T00:00:00.000Z' },
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const query = createListModelProvidersQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: [
					expect.objectContaining({
						id: 'provider-a',
						name: 'Provider A',
						archived: true,
						models: [
							expect.objectContaining({ id: 'model-a', name: 'Model A', archived: false }),
							expect.objectContaining({ id: 'model-b', name: 'Model B', archived: true }),
						],
					}),
					expect.objectContaining({ id: 'provider-b', name: 'Provider B', archived: false, models: [] }),
				],
			})
		})

		it('returns storage errors when providers or models cannot be listed', async () => {
			const providerFailure = createTestCoreServices()
			providerFailure.tx.modelProviders.fail.list = true
			await expect(createListModelProvidersQuery(providerFailure)({})).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'model-provider' } },
			})

			const modelFailure = createTestCoreServices()
			modelFailure.tx.models.fail.list = true
			await expect(createListModelProvidersQuery(modelFailure)({})).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'model' } },
			})
		})
	})
}
