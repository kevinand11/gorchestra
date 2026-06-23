import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Repository } from '../domain/repository'
import type { Slice } from '../domain/slice'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction, type StorageBoundaryError } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { deliveryReadModels, type DeliveryReadModel } from './utils/delivery-read-model'
import { buildQueryHandler } from './utils/handler'
import { listOrderedDeliverySlices } from './utils/slice-read-model'

const listDeliveriesInputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof listDeliveriesInputPipe>

export type Result = DeliveryReadModel[]
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListDeliveriesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listDeliveries', listDeliveriesInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			return await listProjectDeliveries(storage, project.value.id)
		}),
	)
}

async function listProjectDeliveries(
	storage: CoreStorage,
	projectId: string,
): Promise<CoreResult<DeliveryReadModel[], Exclude<Error, InvalidInputError>>> {
	const deliveries = await listRecords('delivery', storage, { where: (filter, fields) => filter.eq(fields.projectId, projectId) })
	if (!deliveries.ok) return deliveries

	const repositories = await listRecords('repository', storage, { where: (filter, fields) => filter.eq(fields.projectId, projectId) })
	if (!repositories.ok) return repositories

	const slices = await listSlicesByDeliveryId(storage, deliveries.value)
	return slices.ok ? deliveryReadModels(deliveries.value, repositories.value, slices.value) : slices
}

async function listSlicesByDeliveryId(
	storage: CoreStorage,
	deliveries: Delivery[],
): Promise<CoreResult<Map<string, Slice[]>, StorageBoundaryError>> {
	const slicesByDeliveryId = new Map<string, Slice[]>()
	for (const delivery of deliveries) {
		const slices = await listOrderedDeliverySlices(storage, delivery.id)
		if (!slices.ok) return slices
		slicesByDeliveryId.set(delivery.id, slices.value)
	}

	return { ok: true, value: slicesByDeliveryId }
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

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('lists Deliveries for one Project with repository targets and ordered Slices', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedProject(options.tx, 'project-2')
			const repositoryOne = repository({ id: 'repository-1', projectId: 'project-1', owner: 'Octo', name: 'Repo' })
			const repositoryOther = repository({ id: 'repository-other', projectId: 'project-2', owner: 'Other', name: 'Repo' })
			options.tx.repositories.records.set(repositoryOne.id, repositoryOne)
			options.tx.repositories.records.set(repositoryOther.id, repositoryOther)
			options.tx.deliveries.records.set(
				'delivery-b',
				delivery({
					id: 'delivery-b',
					projectId: 'project-1',
					title: 'Later',
					repositoryId: 'repository-1',
					acceptedAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.deliveries.records.set(
				'delivery-a',
				delivery({
					id: 'delivery-a',
					projectId: 'project-1',
					title: 'Earlier',
					repositoryId: 'repository-1',
					acceptedAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.deliveries.records.set(
				'delivery-other',
				delivery({ id: 'delivery-other', projectId: 'project-2', title: 'Other', repositoryId: 'repository-other' }),
			)
			options.tx.slices.records.set('slice-b', slice({ id: 'slice-b', deliveryId: 'delivery-a', order: 1, title: 'Second' }))
			options.tx.slices.records.set('slice-a', slice({ id: 'slice-a', deliveryId: 'delivery-a', order: 0, title: 'First' }))
			const query = createListDeliveriesQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						...delivery({
							id: 'delivery-a',
							projectId: 'project-1',
							title: 'Earlier',
							repositoryId: 'repository-1',
							acceptedAt: '2026-06-09T00:00:00.000Z',
						}),
						target: { type: 'source-control', repository: repositoryOne, targetBranch: 'main' },
						slices: [
							slice({ id: 'slice-a', deliveryId: 'delivery-a', order: 0, title: 'First' }),
							slice({ id: 'slice-b', deliveryId: 'delivery-a', order: 1, title: 'Second' }),
						],
					},
					{
						...delivery({
							id: 'delivery-b',
							projectId: 'project-1',
							title: 'Later',
							repositoryId: 'repository-1',
							acceptedAt: '2026-06-10T00:00:00.000Z',
						}),
						target: { type: 'source-control', repository: repositoryOne, targetBranch: 'main' },
						slices: [],
					},
				],
			})
		})

		it('returns storage errors when Delivery reads fail', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.deliveries.fail.list = true
			const query = createListDeliveriesQuery(options)

			const result = await query({ projectId: 'project-1' })

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
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: 'secret-1' },
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
		}
	}

	function delivery(input: { id: string; projectId: string; title: string; repositoryId: string; acceptedAt?: string }): Delivery {
		const accepted = { origin: 'imported' as const, at: input.acceptedAt ?? stamp.at }
		return {
			id: input.id,
			projectId: input.projectId,
			planId: 'plan-1',
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
