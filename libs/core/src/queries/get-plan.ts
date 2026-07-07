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
import { planReadModel } from './plan-read-model'
import { getRequired, listRecords, notFound, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ projectId: idPipe, planId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = planWithPlanningAgentRunPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
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
	return plan.ok ? getPlanReadModelForProjectPlan(storage, projectId, plan.value) : plan
}

async function getPlanReadModelForProjectPlan(
	storage: CoreStorage,
	projectId: string,
	plan: Plan,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	if (plan.projectId !== projectId) return notFound('plan', plan.id)

	const agentRuns = await listRecords('agent-run', storage)
	return agentRuns.ok ? planReadModel(plan, agentRuns.value) : agentRuns
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, seedProject, stamp } = await import('../utils/test-helpers')

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
		it('returns the Plan with its Planning Agent Run when it belongs to the Project', async () => {
			const records = seedPlanDetailRecords('01k00000000000000000000030')

			const result = await createGetPlanQuery(records.options)({
				projectId: '01k00000000000000000000030',
				planId: '01k00000000000000000000028',
			})

			expect(result).toEqual({ ok: true, value: { ...records.plan, agentRun: records.agentRun } })
		})

		it('returns invariant violations when the Plan is missing its Planning Agent Run', async () => {
			const records = seedPlanDetailRecords('01k00000000000000000000030', { agentRun: false })

			const result = await createGetPlanQuery(records.options)({
				projectId: '01k00000000000000000000030',
				planId: '01k00000000000000000000028',
			})

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Plan 01k00000000000000000000028 expected exactly one Planning Agent Run but found 0.',
				},
			})
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

	function seedPlanDetailRecords(projectId: string, options: { agentRun?: boolean } = {}) {
		const services = createTestCoreServices()
		seedProject(services.tx, projectId)
		const storedPlan = plan({ id: '01k00000000000000000000028', projectId, title: 'Plan setup' })
		const storedAgentRun = planningRun('01k00000000000000000000002', '01k00000000000000000000028')
		services.tx.plans.records.set(storedPlan.id, storedPlan)
		if (options.agentRun !== false) services.tx.agentRuns.records.set(storedAgentRun.id, storedAgentRun)
		return { options: services, plan: storedPlan, agentRun: storedAgentRun }
	}

	function plan(input: { id: string; projectId: string; title: string; createdAt?: string }): Plan {
		const createdAt = input.createdAt ?? stamp.at
		return {
			id: input.id,
			projectId: input.projectId,
			title: input.title,
			created: { origin: 'imported', at: createdAt },
			closed: null,
		}
	}

	function planningRun(id: string, planId: string) {
		return {
			id,
			agent: modelAgent(),
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

	function modelAgent() {
		return { type: 'model' as const }
	}
}
