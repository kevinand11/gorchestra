import { type PipeInput, type PipeOutput } from 'valleyed'

import { paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { listedModelProviderPipe } from '../domain/model-provider'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listedModelProviders } from './model-provider-read-model'
import { buildQueryHandler } from '../utils/query-handler'
import { listRecords, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = paginatedQueryInputPipe
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(listedModelProviderPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListModelProvidersQuery(options: CoreServices): Operation {
	return buildQueryHandler('listModelProviders', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const providers = await listRecordsPaginated('model-provider', storage, input)
			if (!providers.ok) return providers

			const providerIds = providers.value.items.map((provider) => provider.id)
			const models =
				providerIds.length === 0
					? { ok: true as const, value: [] }
					: await listRecords('model', storage, {
							where: (filter, fields) => filter.in(fields.providerId, providerIds),
							orderBy: [{ field: 'id', direction: 'desc' }],
						})
			return models.ok
				? { ok: true, value: { ...providers.value, items: listedModelProviders(providers.value.items, models.value) } }
				: models
		}),
	) as Operation
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

			expect(result).toEqual({
				ok: true,
				value: {
					items: [],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 0, total: 0, count: 0 },
				},
			})
		})

		it('lists providers with nested Models in id-desc order and archive state', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000100053')
			seedModelProvider(options.tx, '01k00000000000000000100052', true)
			options.tx.modelProviders.records.set('01k00000000000000000100052', {
				...options.tx.modelProviders.records.get('01k00000000000000000100052')!,
				name: 'Provider A',
				created: { origin: 'imported', at: '2026-06-09T00:00:00.000Z' },
			})
			options.tx.modelProviders.records.set('01k00000000000000000100053', {
				...options.tx.modelProviders.records.get('01k00000000000000000100053')!,
				name: 'Provider B',
				created: { origin: 'imported', at: '2026-06-10T00:00:00.000Z' },
			})
			seedSelectableModel(options.tx, '01k00000000000000000100045')
			options.tx.modelProviders.records.delete('01k00000000000000000050045')
			options.tx.models.records.set('01k00000000000000000100045', {
				...options.tx.models.records.get('01k00000000000000000100045')!,
				providerId: '01k00000000000000000100052',
				name: 'Model A',
				created: { origin: 'imported', at: '2026-06-09T00:00:00.000Z' },
			})
			seedSelectableModel(options.tx, '01k00000000000000000100046', { modelArchived: true })
			options.tx.modelProviders.records.delete('01k00000000000000000050046')
			options.tx.models.records.set('01k00000000000000000100046', {
				...options.tx.models.records.get('01k00000000000000000100046')!,
				providerId: '01k00000000000000000100052',
				name: 'Model B',
				created: { origin: 'imported', at: '2026-06-10T00:00:00.000Z' },
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const query = createListModelProvidersQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						expect.objectContaining({ id: '01k00000000000000000100053', name: 'Provider B', archived: false, models: [] }),
						expect.objectContaining({
							id: '01k00000000000000000100052',
							name: 'Provider A',
							archived: true,
							models: [
								expect.objectContaining({ id: '01k00000000000000000100046', name: 'Model B', archived: true }),
								expect.objectContaining({ id: '01k00000000000000000100045', name: 'Model A', archived: false }),
							],
						}),
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
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
			seedModelProvider(modelFailure.tx, '01k00000000000000000100052')
			modelFailure.tx.models.fail.list = true
			await expect(createListModelProvidersQuery(modelFailure)({})).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'model' } },
			})
		})
	})
}
