import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe, paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { deliveryReadModelPipe, type Delivery } from '../domain/delivery'
import type { Repository } from '../domain/repository'
import type { Slice } from '../domain/slice'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { deliveryReadModels } from '../utils/delivery-read-model'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecords, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = v.merge(v.object({ projectId: idPipe }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(deliveryReadModelPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListDeliveriesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listDeliveries', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const deliveries = await listRecordsPaginated('delivery', storage, input, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
			})
			if (!deliveries.ok) return deliveries

			const repositoryIds = deliveries.value.items.flatMap((delivery) =>
				delivery.target.type === 'source-control' ? [delivery.target.repositoryId] : [],
			)
			const repositories =
				repositoryIds.length === 0
					? { ok: true as const, value: [] }
					: await listRecords('repository', storage, {
							where: (filter, fields) => filter.in(fields.id, repositoryIds),
							orderBy: [{ field: 'id', direction: 'desc' }],
						})
			if (!repositories.ok) return repositories

			const slicesByDeliveryId = new Map<string, Slice[]>()
			const deliveryIds = deliveries.value.items.map((delivery) => delivery.id)
			if (deliveryIds.length > 0) {
				const slices = await listRecords('slice', storage, {
					where: (filter, fields) => filter.in(fields.deliveryId, deliveryIds),
					orderBy: [{ field: 'id', direction: 'desc' }],
				})
				if (!slices.ok) return slices

				for (const slice of slices.value) {
					const deliverySlices = slicesByDeliveryId.get(slice.deliveryId) ?? []
					deliverySlices.push(slice)
					slicesByDeliveryId.set(slice.deliveryId, deliverySlices)
				}
			}

			const readModels = deliveryReadModels(deliveries.value.items, repositories.value, slicesByDeliveryId)
			return readModels.ok ? { ok: true, value: { ...deliveries.value, items: readModels.value } } : readModels
		}),
	) as Operation
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('listDeliveries query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createListDeliveriesQuery(options)

			const result = await query({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listDeliveries' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Project does not exist', async () => {
			const query = createListDeliveriesQuery(createTestCoreServices())

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})

		it('lists Deliveries for one Project with repository targets and ordered Slices', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			seedProject(options.tx, '01k00000000000000000000031')
			const repositoryOne = repository({
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				owner: 'Octo',
				name: 'Repo',
			})
			const repositoryOther = repository({
				id: '01k00000000000000000100028',
				projectId: '01k00000000000000000000031',
				owner: 'Other',
				name: 'Repo',
			})
			options.tx.repositories.records.set(repositoryOne.id, repositoryOne)
			options.tx.repositories.records.set(repositoryOther.id, repositoryOther)
			options.tx.deliveries.records.set(
				'01k00000000000000000100030',
				delivery({
					id: '01k00000000000000000100030',
					projectId: '01k00000000000000000000030',
					title: 'Later',
					repositoryId: '01k00000000000000000000034',
					acceptedAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.deliveries.records.set(
				'01k00000000000000000100029',
				delivery({
					id: '01k00000000000000000100029',
					projectId: '01k00000000000000000000030',
					title: 'Earlier',
					repositoryId: '01k00000000000000000000034',
					acceptedAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.deliveries.records.set(
				'01k00000000000000000100031',
				delivery({
					id: '01k00000000000000000100031',
					projectId: '01k00000000000000000000031',
					title: 'Other',
					repositoryId: '01k00000000000000000100028',
				}),
			)
			options.tx.slices.records.set(
				'01k00000000000000000100039',
				slice({ id: '01k00000000000000000100039', deliveryId: '01k00000000000000000100029', order: 1, title: 'Second' }),
			)
			options.tx.slices.records.set(
				'01k00000000000000000100038',
				slice({ id: '01k00000000000000000100038', deliveryId: '01k00000000000000000100029', order: 0, title: 'First' }),
			)
			const query = createListDeliveriesQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						{
							...delivery({
								id: '01k00000000000000000100030',
								projectId: '01k00000000000000000000030',
								title: 'Later',
								repositoryId: '01k00000000000000000000034',
								acceptedAt: '2026-06-10T00:00:00.000Z',
							}),
							target: { type: 'source-control', repository: repositoryOne, targetBranch: 'main' },
							slices: [],
						},
						{
							...delivery({
								id: '01k00000000000000000100029',
								projectId: '01k00000000000000000000030',
								title: 'Earlier',
								repositoryId: '01k00000000000000000000034',
								acceptedAt: '2026-06-09T00:00:00.000Z',
							}),
							target: { type: 'source-control', repository: repositoryOne, targetBranch: 'main' },
							slices: [
								slice({
									id: '01k00000000000000000100039',
									deliveryId: '01k00000000000000000100029',
									order: 1,
									title: 'Second',
								}),
								slice({
									id: '01k00000000000000000100038',
									deliveryId: '01k00000000000000000100029',
									order: 0,
									title: 'First',
								}),
							],
						},
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('returns storage errors when Delivery reads fail', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.deliveries.fail.list = true
			const query = createListDeliveriesQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'delivery' } },
			})
		})
	})

	function repository(input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
		}
	}

	function delivery(input: { id: string; projectId: string; title: string; repositoryId: string; acceptedAt?: string }): Delivery {
		const accepted = { origin: 'imported' as const, at: input.acceptedAt ?? stamp.at }
		return {
			id: input.id,
			projectId: input.projectId,
			planId: '01k00000000000000000000028',
			title: input.title,
			target: { type: 'source-control', repositoryId: input.repositoryId, targetBranch: 'main' },
			config: null,
			accepted,
			queued: null,
			closed: null,
		}
	}

	function slice(input: { id: string; deliveryId: string; order: number; title: string }): Slice {
		const accepted = { origin: 'imported' as const, at: stamp.at }
		return {
			id: input.id,
			deliveryId: input.deliveryId,
			order: input.order,
			title: input.title,
			instruction: { body: `${input.title} instructions.` },
			accepted,
		}
	}
}
