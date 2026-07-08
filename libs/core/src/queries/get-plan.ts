import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { planPipe, type Plan } from '../domain/plan'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, notFound, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ projectId: idPipe, planId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = planPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetPlanQuery(options: CoreServices): Operation {
	return buildQueryHandler('getPlan', inputPipe, (input) =>
		withTransaction(options, (storage) => getProjectPlanReadModel(storage, input.projectId, input.planId)),
	)
}

async function getProjectPlanReadModel(
	storage: CoreStorage,
	projectId: string,
	planId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, projectId)
	return project.ok ? getPlanForProject(storage, project.value.id, planId) : project
}

async function getPlanForProject(
	storage: CoreStorage,
	projectId: string,
	planId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const plan = await getRequired('plan', storage, planId)
	return plan.ok ? getPlanReadModelForProjectPlan(projectId, plan.value) : plan
}

function getPlanReadModelForProjectPlan(projectId: string, plan: Plan): CoreResult<Result, Exclude<Error, InvalidInputError>> {
	if (plan.projectId !== projectId) return notFound('plan', plan.id)

	return { ok: true, value: plan }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('getPlan query', () => {
		registerInputBoundaryTests()
		registerPlanReadModelTests()
		registerProjectBoundaryTests()
		registerPlanBoundaryTests()
	})

	function registerInputBoundaryTests() {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true

			const result = await createGetPlanQuery(options)({ projectId: '', planId: '01k00000000000000000000028' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getPlan' },
			})
			expect(options.transactionCalls()).toBe(0)
		})
	}

	function registerPlanReadModelTests() {
		it('returns the stored Plan when it belongs to the Project without reading Agent Runs', async () => {
			const records = seedPlanDetailRecords('01k00000000000000000000030')
			records.options.tx.agentRuns.fail.list = true
			records.options.tx.agentRuns.fail.get = true

			const result = await createGetPlanQuery(records.options)({
				projectId: '01k00000000000000000000030',
				planId: '01k00000000000000000000028',
			})

			expect(result).toEqual({ ok: true, value: records.plan })
		})
	}

	function registerProjectBoundaryTests() {
		it('returns not-found when the Project does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.plans.records.set(
				'01k00000000000000000000028',
				plan({ id: '01k00000000000000000000028', projectId: '01k00000000000000000000030', title: 'Plan setup' }),
			)

			const result = await createGetPlanQuery(options)({
				projectId: '01k00000000000000000000030',
				planId: '01k00000000000000000000028',
			})

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})
	}

	function registerPlanBoundaryTests() {
		it('returns not-found when the Plan does not belong to the Project', async () => {
			const records = seedPlanDetailRecords('01k00000000000000000000031')
			seedProject(records.options.tx, '01k00000000000000000000030')

			const result = await createGetPlanQuery(records.options)({
				projectId: '01k00000000000000000000030',
				planId: '01k00000000000000000000028',
			})

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'plan', id: '01k00000000000000000000028' } })
		})
	}

	function seedPlanDetailRecords(projectId: string) {
		const services = createTestCoreServices()
		seedProject(services.tx, projectId)
		const storedPlan = plan({ id: '01k00000000000000000000028', projectId, title: 'Plan setup' })
		services.tx.plans.records.set(storedPlan.id, storedPlan)
		return { options: services, plan: storedPlan }
	}

	function plan(input: { id: string; projectId: string; title: string; createdAt?: string }): Plan {
		const createdAt = input.createdAt ?? stamp.at
		return {
			id: input.id,
			projectId: input.projectId,
			agentRunId: '01k00000000000000000000002',
			title: input.title,
			created: { origin: 'imported', at: createdAt },
			closed: null,
		}
	}
}
