import { v, type PipeOutput } from 'valleyed'

import type { AgentRun } from '../domain/agent-run'
import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type OperationContext, type RuntimeRecord } from '../domain/commons'
import type { PortfolioConfigRecord } from '../domain/config'
import { planConfigPipe } from '../domain/config'
import type { Plan, PlanWithPlanningAgentRun } from '../domain/plan'
import type { Project } from '../domain/project'
import type { AgentRunModelUnresolvedError, InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent, createModelAgentRunWithInitialModel } from '../utils/agent-run-events'
import type { CoreRuntimeValues } from '../utils/runtime-values'
import type { Result as CoreResult } from '../utils/types'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	auditStamp,
	createRecordValue,
	getPortfolioConfig,
	getRequired,
	nextId,
	normalizePlanConfigRecord,
	runtimeRecord,
	validateSelectableModels,
	withTransaction,
} from './utils/storage'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	initialMessage: nonEmptyTrimmedStringPipe,
	config: v.nullable(planConfigPipe),
})
export type Input = PipeOutput<typeof createPlanInputPipe>

export type Result = PlanWithPlanningAgentRun

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError | AgentRunModelUnresolvedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreatePlanCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createPlan', createPlanInputPipe, (input, context) => handleCreatePlan(runtime, input, context))
}

type PlanCreationRuntimeValues = {
	stamp: AuditStamp
	planId: Id
	agentRunId: Id
	started: RuntimeRecord
	runtimeValues: CoreRuntimeValues
}

type PlanCreationFacts = {
	plan: Plan
	agentRunId: Id
	started: RuntimeRecord
	modelId: Id
	initialMessage: string
	stamp: AuditStamp
	runtimeValues: CoreRuntimeValues
}

async function handleCreatePlan(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<PlanWithPlanningAgentRun, Error>> {
	const values = planCreationRuntimeValues(runtime, context)
	return values.ok ? withTransaction(runtime.services, (storage) => writePlan(storage, input, values.value)) : values
}

function planCreationRuntimeValues(
	runtime: CoreRuntime,
	context: OperationContext,
): CoreResult<PlanCreationRuntimeValues, ConfigCommandStorageError> {
	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? planCreationRuntimeValuesAfterStamp(runtime, stamp.value) : stamp
}

function planCreationRuntimeValuesAfterStamp(
	runtime: CoreRuntime,
	stamp: AuditStamp,
): CoreResult<PlanCreationRuntimeValues, ConfigCommandStorageError> {
	const planId = nextId(runtime.values, 'plan')
	return planId.ok ? planCreationRuntimeValuesAfterPlanId(runtime, stamp, planId.value) : planId
}

function planCreationRuntimeValuesAfterPlanId(
	runtime: CoreRuntime,
	stamp: AuditStamp,
	planId: Id,
): CoreResult<PlanCreationRuntimeValues, ConfigCommandStorageError> {
	const agentRunId = nextId(runtime.values, 'agent-run')
	return agentRunId.ok ? planCreationRuntimeValuesAfterAgentRunId(runtime, stamp, planId, agentRunId.value) : agentRunId
}

function planCreationRuntimeValuesAfterAgentRunId(
	runtime: CoreRuntime,
	stamp: AuditStamp,
	planId: Id,
	agentRunId: Id,
): CoreResult<PlanCreationRuntimeValues, ConfigCommandStorageError> {
	const started = runtimeRecord(runtime.values)
	return started.ok ? { ok: true, value: { stamp, planId, agentRunId, started: started.value, runtimeValues: runtime.values } } : started
}

async function writePlan(
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<PlanWithPlanningAgentRun, Exclude<Error, InvalidInputError>>> {
	const facts = await planCreationFacts(storage, input, values)
	return facts.ok ? writePlanCreationFacts(storage, facts.value) : facts
}

async function planCreationFacts(
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, input.projectId)
	return project.ok ? planCreationFactsForProject(storage, input, values, project.value) : project
}

async function planCreationFactsForProject(
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
	project: Project,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const config = normalizePlanConfigRecord(input.config, values.stamp)
	const modelId = await resolvePlanningModelId(storage, values.planId, config, project)
	return modelId.ok ? validatedPlanCreationFacts(storage, input, values, project, config, modelId.value) : modelId
}

async function validatedPlanCreationFacts(
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
	project: Project,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	modelId: Id,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const modelValidation = await validateSelectableModels(storage, [modelId])
	return modelValidation.ok ? { ok: true, value: planCreationFactsValue(input, values, project, config, modelId) } : modelValidation
}

function planCreationFactsValue(
	input: Input,
	values: PlanCreationRuntimeValues,
	project: Project,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	modelId: Id,
): PlanCreationFacts {
	return {
		plan: { id: values.planId, projectId: project.id, title: input.title, config, created: values.stamp },
		agentRunId: values.agentRunId,
		started: values.started,
		modelId,
		initialMessage: input.initialMessage,
		stamp: values.stamp,
		runtimeValues: values.runtimeValues,
	}
}

async function writePlanCreationFacts(
	storage: CoreStorage,
	facts: PlanCreationFacts,
): Promise<CoreResult<PlanWithPlanningAgentRun, Exclude<Error, InvalidInputError>>> {
	const storedPlan = await createRecordValue('plan', storage, facts.plan)
	return storedPlan.ok ? writePlanningAgentRun(storage, storedPlan.value, facts) : storedPlan
}

async function writePlanningAgentRun(
	storage: CoreStorage,
	plan: Plan,
	facts: PlanCreationFacts,
): Promise<CoreResult<PlanWithPlanningAgentRun, Exclude<Error, InvalidInputError>>> {
	const storedAgentRun = await createModelAgentRunWithInitialModel({ values: facts.runtimeValues }, storage, {
		agentRunId: facts.agentRunId,
		purpose: { type: 'planning', planId: plan.id },
		started: facts.started,
		modelId: facts.modelId,
	})
	return storedAgentRun.ok ? writeInitialPlanningInput(storage, plan, storedAgentRun.value, facts) : storedAgentRun
}

async function writeInitialPlanningInput(
	storage: CoreStorage,
	plan: Plan,
	agentRun: PlanWithPlanningAgentRun['agentRun'],
	facts: PlanCreationFacts,
): Promise<CoreResult<PlanWithPlanningAgentRun, Exclude<Error, InvalidInputError>>> {
	const input = await appendAgentRunEvent({ values: facts.runtimeValues }, storage, agentRun.id, {
		type: 'input-message',
		source: { type: 'operator', authorized: facts.stamp },
		content: [{ type: 'text', text: facts.initialMessage }],
	})
	return input.ok ? { ok: true, value: { ...plan, agentRun } } : input
}

async function resolvePlanningModelId(
	storage: CoreStorage,
	planId: Id,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	project: Project,
): Promise<CoreResult<Id, Exclude<Error, InvalidInputError | ConfigCommandReferenceError>>> {
	const portfolioConfig = await getPortfolioConfig(storage)
	return portfolioConfig.ok ? resolvedPlanningModelId(planId, config, project, portfolioConfig.value) : portfolioConfig
}

function resolvedPlanningModelId(
	planId: Id,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	project: Project,
	portfolioConfig: PortfolioConfigRecord | null,
): CoreResult<Id, AgentRunModelUnresolvedError> {
	const modelId = firstPresent([
		planPlanningModelId(config),
		projectPlanningModelId(project),
		portfolioPlanningModelId(portfolioConfig),
		portfolioDefaultModelId(portfolioConfig),
	])
	return modelId === null ? agentRunModelUnresolved({ type: 'planning', planId }) : { ok: true, value: modelId }
}

function planPlanningModelId(config: ReturnType<typeof normalizePlanConfigRecord>): Id | null {
	return config?.value?.model?.planningModelId ?? null
}

function projectPlanningModelId(project: Project): Id | null {
	return project.config?.value?.model?.planningModelId ?? null
}

function portfolioPlanningModelId(config: PortfolioConfigRecord | null): Id | null {
	return config?.value.model.planningModelId ?? null
}

function portfolioDefaultModelId(config: PortfolioConfigRecord | null): Id | null {
	return config?.value.model.defaultModelId ?? null
}

function firstPresent<T>(values: Array<T | null | undefined>): T | null {
	return values.find((candidate): candidate is T => candidate !== null && candidate !== undefined) ?? null
}

function agentRunModelUnresolved(purpose: AgentRun['purpose']): CoreResult<never, AgentRunModelUnresolvedError> {
	return { ok: false, error: { type: 'agent-run-model-unresolved', purpose } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSelectableModel, stamp } =
		await import('../utils/test-helpers')

	describe('createPlan command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', title: 'Plan', initialMessage: ' ', config: null }, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'createPlan' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a Plan and Planning Agent Run with initial model selection for existing Projects without Repository setup', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedSelectableModel(options.tx, 'model-1')
			options.tx.portfolioConfig.record = portfolioConfig('model-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: 'project-1',
					title: '  Plan setup  ',
					initialMessage: '  Please plan repository onboarding.  ',
					config: { model: { planningModelId: null } },
				},
				context,
			)

			expect(result).toEqual({ ok: true, value: { ...expectedPlan(), agentRun: expectedPlanningAgentRun() } })
			expect(options.tx.plans.records.get('plan-1')).toEqual(expectedPlan())
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedPlanningAgentRun())
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toEqual({
				type: 'agent-run-model-selected',
				modelId: 'model-1',
				modelProviderId: 'model-1-provider',
				protocol: 'anthropic-messages',
				authorized: null,
			})
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')?.body).toEqual({
				type: 'input-message',
				source: { type: 'operator', authorized: localStamp() },
				content: [{ type: 'text', text: 'Please plan repository onboarding.' }],
			})
		})

		it('resolves the Planning Model from Plan, Project, Portfolio Planning, then Portfolio default config', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedSelectableModel(options.tx, 'model-plan')
			seedSelectableModel(options.tx, 'model-project')
			seedSelectableModel(options.tx, 'model-portfolio-planning')
			seedSelectableModel(options.tx, 'model-portfolio-default')
			options.tx.projects.records.get('project-1')!.config = {
				configured: localStamp(),
				value: {
					model: {
						planningModelId: 'model-project',
						revisionPlanningModelId: null,
						executionModelId: null,
						revisionExecutionModelId: null,
					},
					work: null,
				},
			}
			options.tx.portfolioConfig.record = portfolioConfig('model-portfolio-default', 'model-portfolio-planning')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: 'project-1',
					title: 'Plan',
					initialMessage: 'Plan this.',
					config: { model: { planningModelId: 'model-plan' } },
				},
				context,
			)

			expect(result).toMatchObject({ ok: true, value: { agentRun: { agent: { type: 'model' } } } })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toMatchObject({ modelId: 'model-plan' })
		})

		it('rejects Plans when no Planning Model can be resolved', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.', config: null }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-model-unresolved', purpose: { type: 'planning', planId: 'plan-1' } },
			})
			expect(options.tx.plans.records.size).toBe(0)
			expect(options.tx.agentRuns.records.size).toBe(0)
		})
	})

	function expectedPlan(): Plan {
		return {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan setup',
			config: null,
			created: localStamp(),
		}
	}

	function expectedPlanningAgentRun(): AgentRun {
		return {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}

	function portfolioConfig(defaultModelId: string, planningModelId: string | null = null): PortfolioConfigRecord {
		return {
			configured: stamp,
			value: {
				model: {
					defaultModelId,
					planningModelId,
					revisionPlanningModelId: null,
					executionModelId: null,
					revisionExecutionModelId: null,
				},
				work: null,
			},
		}
	}
}
