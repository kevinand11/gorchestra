import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { deliveryReadModelPipe, type Delivery } from '../domain/delivery'
import type { Repository } from '../domain/repository'
import type { Slice } from '../domain/slice'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { getRequired, listRecords, notFound, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { deliveryReadModel } from './utils/delivery-read-model'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ projectId: idPipe, deliveryId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = deliveryReadModelPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetDeliveryQuery(options: CoreServices): Operation {
	return buildQueryHandler('getDelivery', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			return project.ok ? getProjectDeliveryReadModel(storage, input.deliveryId, project.value.id) : project
		}),
	)
}

async function getProjectDeliveryReadModel(storage: Parameters<typeof getRequired>[1], deliveryId: string, projectId: string) {
	const delivery = await getProjectDelivery(storage, deliveryId, projectId)
	if (!delivery.ok) return delivery

	const repository = await getProjectRepository(storage, delivery.value.target.repositoryId, projectId)
	if (!repository.ok) return repository

	const slices = await listRecords('slice', storage, {
		where: (filter, fields) => filter.eq(fields.deliveryId, delivery.value.id),
		orderBy: [{ field: 'id', direction: 'desc' }],
	})
	return slices.ok ? deliveryReadModel(delivery.value, new Map([[repository.value.id, repository.value]]), slices.value) : slices
}

async function getProjectDelivery(storage: Parameters<typeof getRequired>[1], deliveryId: string, projectId: string) {
	const delivery = await getRequired('delivery', storage, deliveryId)
	if (!delivery.ok) return delivery
	return delivery.value.projectId === projectId ? delivery : notFound('delivery', deliveryId)
}

async function getProjectRepository(storage: Parameters<typeof getRequired>[1], repositoryId: string, projectId: string) {
	const repository = await getRequired('repository', storage, repositoryId)
	if (!repository.ok) return repository
	return repository.value.projectId === projectId ? repository : notFound('repository', repositoryId)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject } = await import('../utils/test-helpers')

	describe('getDelivery query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createGetDeliveryQuery(options)

			const result = await query({ projectId: '', deliveryId: '01k00000000000000000000008' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getDelivery' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns the Delivery read model when it belongs to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			const storedRepository = repository({
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				owner: 'Octo',
				name: 'Repo',
			})
			const storedDelivery = delivery({
				id: '01k00000000000000000000008',
				projectId: '01k00000000000000000000030',
				title: 'Build API',
				repositoryId: '01k00000000000000000000034',
			})
			options.tx.repositories.records.set(storedRepository.id, storedRepository)
			options.tx.deliveries.records.set(storedDelivery.id, storedDelivery)
			options.tx.slices.records.set(
				'01k00000000000000000100039',
				slice({ id: '01k00000000000000000100039', deliveryId: '01k00000000000000000000008', order: 1, title: 'Route' }),
			)
			options.tx.slices.records.set(
				'01k00000000000000000100038',
				slice({ id: '01k00000000000000000100038', deliveryId: '01k00000000000000000000008', order: 0, title: 'Schema' }),
			)
			const query = createGetDeliveryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', deliveryId: '01k00000000000000000000008' })

			expect(result).toEqual({
				ok: true,
				value: {
					...storedDelivery,
					target: { type: 'source-control', repository: storedRepository, targetBranch: 'main' },
					slices: [
						slice({ id: '01k00000000000000000100039', deliveryId: '01k00000000000000000000008', order: 1, title: 'Route' }),
						slice({ id: '01k00000000000000000100038', deliveryId: '01k00000000000000000000008', order: 0, title: 'Schema' }),
					],
				},
			})
		})

		it('returns not-found when the Project does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.deliveries.records.set(
				'01k00000000000000000000008',
				delivery({
					id: '01k00000000000000000000008',
					projectId: '01k00000000000000000000030',
					title: 'Build API',
					repositoryId: '01k00000000000000000000034',
				}),
			)
			const query = createGetDeliveryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', deliveryId: '01k00000000000000000000008' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})

		it('returns not-found when the Delivery does not belong to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.deliveries.records.set(
				'01k00000000000000000000008',
				delivery({
					id: '01k00000000000000000000008',
					projectId: '01k00000000000000000000031',
					title: 'Build API',
					repositoryId: '01k00000000000000000000034',
				}),
			)
			const query = createGetDeliveryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', deliveryId: '01k00000000000000000000008' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'delivery', id: '01k00000000000000000000008' } })
		})
	})

	function repository(input: { id: string; projectId: string; owner: string; name: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
		}
	}

	function delivery(input: { id: string; projectId: string; title: string; repositoryId: string }): Delivery {
		return {
			id: input.id,
			projectId: input.projectId,
			planId: '01k00000000000000000000028',
			title: input.title,
			target: { type: 'source-control', repositoryId: input.repositoryId, targetBranch: 'main' },
			config: null,
			accepted: { origin: 'imported', at: '2026-06-02T00:00:00.000Z' },
			queued: null,
			closed: null,
		}
	}

	function slice(input: { id: string; deliveryId: string; order: number; title: string }): Slice {
		return {
			id: input.id,
			deliveryId: input.deliveryId,
			order: input.order,
			title: input.title,
			instruction: { body: `${input.title} instructions.` },
			accepted: { origin: 'imported', at: '2026-06-03T00:00:00.000Z' },
		}
	}
}
