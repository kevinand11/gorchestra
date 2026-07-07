import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe, paginatedQueryEnvelopePipe, paginatedQueryInputPipe, type PaginatedQueryEnvelope } from '../domain/commons'
import { planWithPlanningAgentRunPipe, type Plan } from '../domain/plan'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { planReadModels } from './plan-read-model'
import { getRequired, listRecords, listRecordsPaginated, withTransaction } from '../storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.merge(v.object({ projectId: idPipe }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(planWithPlanningAgentRunPipe)
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
		withTransaction(options, (storage) => listProjectPlanReadModels(storage, input)),
	) as Operation
}

async function listProjectPlanReadModels(
	storage: CoreStorage,
	input: PipeOutput<typeof inputPipe>,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, input.projectId)
	return project.ok ? listPlansForProject(storage, input, project.value.id) : project
}

async function listPlansForProject(
	storage: CoreStorage,
	input: PipeOutput<typeof inputPipe>,
	projectId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const plans = await listRecordsPaginated('plan', storage, input, { where: (filter, fields) => filter.eq(fields.projectId, projectId) })
	return plans.ok ? listPlanReadModelsForPlans(storage, plans.value) : plans
}

async function listPlanReadModelsForPlans(
	storage: CoreStorage,
	plans: PaginatedQueryEnvelope<Plan>,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const agentRuns = plans.items.length === 0 ? { ok: true as const, value: [] } : await listRecords('agent-run', storage)
	if (!agentRuns.ok) return agentRuns
	const readModels = planReadModels(plans.items, agentRuns.value)
	return readModels.ok ? { ok: true, value: { ...plans, items: readModels.value } } : readModels
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, seedProject, stamp } = await import('../utils/test-helpers')

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
			const result = await createListPlansQuery(createTestCoreServices())({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})
	}

	function registerPlanReadModelTests() {
		it('lists Plans with Planning Agent Runs for one Project in id-desc order', async () => {
			const records = seedPlanListRecords()

			const result = await createListPlansQuery(records.options)({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						{ ...records.planB, agentRun: records.runB },
						{ ...records.planA, agentRun: records.runA },
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('returns invariant violations when a listed Plan is missing its Planning Agent Run', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set(
				'01k00000000000000000000028',
				plan({ id: '01k00000000000000000000028', projectId: '01k00000000000000000000030', title: 'Plan' }),
			)

			const result = await createListPlansQuery(options)({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Plan 01k00000000000000000000028 expected exactly one Planning Agent Run but found 0.',
				},
			})
		})
	}

	function registerStorageFailureTests() {
		it('returns storage errors when Plan or Agent Run reads fail', async () => {
			await expect(createListPlansQuery(planListReadFailure('plan'))({ projectId: '01k00000000000000000000030' })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'plan' } },
			})
			await expect(
				createListPlansQuery(planListReadFailure('agent-run'))({ projectId: '01k00000000000000000000030' }),
			).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'agent-run' } },
			})
		})
	}

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
		const runA = planningRun('01k00000000000000000100017', '01k00000000000000000100013')
		const runB = planningRun('01k00000000000000000100018', '01k00000000000000000100014')
		options.tx.agentRuns.records.set(runA.id, runA)
		options.tx.agentRuns.records.set(runB.id, runB)
		options.tx.agentRuns.records.set(
			'01k00000000000000000100021',
			planningRun('01k00000000000000000100021', '01k00000000000000000100015'),
		)
		return { options, planA, planB, runA, runB }
	}

	function planListReadFailure(resource: 'plan' | 'agent-run') {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		if (resource === 'plan') options.tx.plans.fail.list = true
		if (resource === 'agent-run') {
			options.tx.plans.records.set(
				'01k00000000000000000000028',
				plan({ id: '01k00000000000000000000028', projectId: '01k00000000000000000000030', title: 'Plan' }),
			)
			options.tx.agentRuns.fail.list = true
		}
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
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' as const },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: null,
			started: { at: stamp.at },
			completed: null,
		}
	}
}
