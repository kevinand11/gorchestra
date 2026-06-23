import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { Plan } from '../domain/plan'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { sortByCreatedAtThenId } from './list-projects'
import { buildQueryHandler } from './utils'
import { getRequired, listRecords, withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const listPlansInputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof listPlansInputPipe>

export type Result = Plan[]
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListPlansQuery(options: CoreServices): Operation {
	return buildQueryHandler('listPlans', listPlansInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const plans = await listRecords('plan', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
			})
			return plans.ok ? { ok: true, value: sortByCreatedAtThenId(plans.value) } : plans
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('listPlans query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createListPlansQuery(options)

			const result = await query({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listPlans' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Project does not exist', async () => {
			const query = createListPlansQuery(createTestCoreServices())

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('lists Plans for one Project in creation order', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedProject(options.tx, 'project-2')
			options.tx.plans.records.set(
				'plan-b',
				plan({ id: 'plan-b', projectId: 'project-1', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
			)
			options.tx.plans.records.set(
				'plan-a',
				plan({ id: 'plan-a', projectId: 'project-1', title: 'Earlier', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.plans.records.set('plan-other', plan({ id: 'plan-other', projectId: 'project-2', title: 'Other' }))
			const query = createListPlansQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					plan({ id: 'plan-a', projectId: 'project-1', title: 'Earlier', createdAt: '2026-06-09T00:00:00.000Z' }),
					plan({ id: 'plan-b', projectId: 'project-1', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
				],
			})
		})

		it('returns storage errors when Plan reads fail', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.plans.fail.list = true
			const query = createListPlansQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'plan' } },
			})
		})
	})

	function plan(input: { id: string; projectId: string; title: string; createdAt?: string }): Plan {
		return {
			id: input.id,
			projectId: input.projectId,
			title: input.title,
			config: null,
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
		}
	}
}
