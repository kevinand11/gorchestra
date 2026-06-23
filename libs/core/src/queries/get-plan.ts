import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { Plan } from '../domain/plan'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from './utils'
import { getRequired, notFound, withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const getPlanInputPipe = v.object({ projectId: idPipe, planId: idPipe })
export type Input = PipeOutput<typeof getPlanInputPipe>

export type Result = Plan
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetPlanQuery(options: CoreServices): Operation {
	return buildQueryHandler('getPlan', getPlanInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const plan = await getRequired('plan', storage, input.planId)
			if (!plan.ok) return plan

			return plan.value.projectId === project.value.id ? { ok: true, value: plan.value } : notFound('plan', input.planId)
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('getPlan query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createGetPlanQuery(options)

			const result = await query({ projectId: '', planId: 'plan-1' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getPlan' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns the Plan when it belongs to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			const storedPlan = plan({ id: 'plan-1', projectId: 'project-1', title: 'Plan setup' })
			options.tx.plans.records.set('plan-1', storedPlan)
			const query = createGetPlanQuery(options)

			const result = await query({ projectId: 'project-1', planId: 'plan-1' })

			expect(result).toEqual({ ok: true, value: storedPlan })
		})

		it('returns not-found when the Project does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.plans.records.set('plan-1', plan({ id: 'plan-1', projectId: 'project-1', title: 'Plan setup' }))
			const query = createGetPlanQuery(options)

			const result = await query({ projectId: 'project-1', planId: 'plan-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('returns not-found when the Plan does not belong to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.plans.records.set('plan-1', plan({ id: 'plan-1', projectId: 'project-2', title: 'Plan setup' }))
			const query = createGetPlanQuery(options)

			const result = await query({ projectId: 'project-1', planId: 'plan-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'plan', id: 'plan-1' } })
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
