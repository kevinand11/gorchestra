import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { planWithPlanningAgentRunPipe, type Plan } from '../domain/plan'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { sortByCreatedAtThenId } from './list-projects'
import { planReadModels } from './plan-read-model'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(planWithPlanningAgentRunPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListPlansQuery(options: CoreServices): Operation {
	return buildQueryHandler('listPlans', inputPipe, (input) =>
		withTransaction(options, (storage) => listProjectPlanReadModels(storage, input.projectId)),
	)
}

async function listProjectPlanReadModels(
	storage: CoreStorage,
	projectId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, projectId)
	return project.ok ? listPlansForProject(storage, project.value.id) : project
}

async function listPlansForProject(
	storage: CoreStorage,
	projectId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const plans = await listRecords('plan', storage, { where: (filter, fields) => filter.eq(fields.projectId, projectId) })
	return plans.ok ? listPlanReadModelsForPlans(storage, plans.value) : plans
}

async function listPlanReadModelsForPlans(
	storage: CoreStorage,
	plans: Plan[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const agentRuns = await listRecords('agent-run', storage)
	return agentRuns.ok ? planReadModels(sortByCreatedAtThenId(plans), agentRuns.value) : agentRuns
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject, stamp } = await import('../utils/test-helpers')

	describe('listPlans query', () => {
		registerInputBoundaryTests()
		registerProjectBoundaryTests()
		registerPlanReadModelTests()
		registerStorageFailureTests()
	})

	function registerInputBoundaryTests() {
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
	}

	function registerProjectBoundaryTests() {
		it('returns not-found when the target Project does not exist', async () => {
			const result = await createListPlansQuery(createTestCoreServices())({ projectId: 'project-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})
	}

	function registerPlanReadModelTests() {
		it('lists Plans with Planning Agent Runs for one Project in creation order', async () => {
			const records = seedPlanListRecords()

			const result = await createListPlansQuery(records.options)({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{ ...records.planA, agentRun: records.runA },
					{ ...records.planB, agentRun: records.runB },
				],
			})
		})

		it('returns invariant violations when a listed Plan is missing its Planning Agent Run', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.plans.records.set('plan-1', plan({ id: 'plan-1', projectId: 'project-1', title: 'Plan' }))

			const result = await createListPlansQuery(options)({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Plan plan-1 expected exactly one Planning Agent Run but found 0.' },
			})
		})
	}

	function registerStorageFailureTests() {
		it('returns storage errors when Plan or Agent Run reads fail', async () => {
			await expect(createListPlansQuery(planListReadFailure('plan'))({ projectId: 'project-1' })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'plan' } },
			})
			await expect(createListPlansQuery(planListReadFailure('agent-run'))({ projectId: 'project-1' })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'agent-run' } },
			})
		})
	}

	function seedPlanListRecords() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		seedProject(options.tx, 'project-2')
		const planB = plan({ id: 'plan-b', projectId: 'project-1', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' })
		const planA = plan({ id: 'plan-a', projectId: 'project-1', title: 'Earlier', createdAt: '2026-06-09T00:00:00.000Z' })
		options.tx.plans.records.set('plan-b', planB)
		options.tx.plans.records.set('plan-a', planA)
		options.tx.plans.records.set('plan-other', plan({ id: 'plan-other', projectId: 'project-2', title: 'Other' }))
		const runA = planningRun('agent-run-a', 'plan-a')
		const runB = planningRun('agent-run-b', 'plan-b')
		options.tx.agentRuns.records.set(runA.id, runA)
		options.tx.agentRuns.records.set(runB.id, runB)
		options.tx.agentRuns.records.set('agent-run-other', planningRun('agent-run-other', 'plan-other'))
		return { options, planA, planB, runA, runB }
	}

	function planListReadFailure(resource: 'plan' | 'agent-run') {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		if (resource === 'plan') options.tx.plans.fail.list = true
		if (resource === 'agent-run') options.tx.agentRuns.fail.list = true
		return options
	}

	function plan(input: { id: string; projectId: string; title: string; createdAt?: string }): Plan {
		return {
			id: input.id,
			projectId: input.projectId,
			title: input.title,
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
			closed: null,
		}
	}

	function planningRun(id: string, planId: string) {
		return {
			id,
			agent: { type: 'model' as const },
			purpose: { type: 'planning' as const, planId },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' as const },
			},
			modelUseOverride: null,
			started: { at: stamp.at },
			completed: null,
		}
	}
}
