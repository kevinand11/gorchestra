import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe, paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { planPipe, type Plan } from '../domain/plan'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = v.merge(v.object({ projectId: idPipe }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(planPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListPlansQuery(options: CoreServices): Operation {
	return buildQueryHandler('listPlans', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			return await listRecordsPaginated('plan', storage, input, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
			})
		}),
	) as Operation
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('listPlans query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const result = await createListPlansQuery(options)({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listPlans' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Project does not exist', async () => {
			const result = await createListPlansQuery(createTestCoreServices())({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})

		it('lists stored Plans for one Project in id-desc order without reading Agent Runs', async () => {
			const records = seedPlanListRecords()
			records.options.tx.agentRuns.fail.list = true

			const result = await createListPlansQuery(records.options)({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [records.planB, records.planA],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('returns storage errors when Plan reads fail', async () => {
			await expect(createListPlansQuery(planListReadFailure())({ projectId: '01k00000000000000000000030' })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'plan' } },
			})
		})
	})

	function seedPlanListRecords() {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		seedProject(options.tx, '01k00000000000000000000031')
		const planB = plan({
			id: '01k00000000000000000100014',
			projectId: '01k00000000000000000000030',
			title: 'Later',
			createdAt: '2026-06-10T00:00:00.000Z',
		})
		const planA = plan({
			id: '01k00000000000000000100013',
			projectId: '01k00000000000000000000030',
			title: 'Earlier',
			createdAt: '2026-06-09T00:00:00.000Z',
		})
		options.tx.plans.records.set('01k00000000000000000100014', planB)
		options.tx.plans.records.set('01k00000000000000000100013', planA)
		options.tx.plans.records.set(
			'01k00000000000000000100015',
			plan({ id: '01k00000000000000000100015', projectId: '01k00000000000000000000031', title: 'Other' }),
		)
		return { options, planA, planB }
	}

	function planListReadFailure() {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		options.tx.plans.fail.list = true
		return options
	}

	function plan(input: { id: string; projectId: string; title: string; createdAt?: string }): Plan {
		return {
			id: input.id,
			projectId: input.projectId,
			agentRunId: `${input.id.slice(0, -1)}9`,
			title: input.title,
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
			closed: null,
		}
	}
}
