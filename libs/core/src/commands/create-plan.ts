import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun, AgentRunInstruction } from '../domain/agent-run'
import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type RuntimeRecord } from '../domain/commons'
import type { ModelUseConfig, PortfolioConfigRecord } from '../domain/config'
import { planConfigPipe } from '../domain/config'
import type { Plan, PlanWithPlanningAgentRun } from '../domain/plan'
import type { Project } from '../domain/project'
import type { AgentRunModelUseUnresolvedError, InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { planningInstructionForProject } from '../runtime/agent-runs/instructions'
import type { CoreDispatchRequest, CoreStorage } from '../services'
import { appendAgentRunEvent, createModelAgentRunWithInitialModel } from '../utils/agent-run-events'
import type { CoreRuntimeValues } from '../utils/runtime-values'
import type { Result as CoreResult } from '../utils/types'
import { acceptDispatchRequest } from './utils/dispatch'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	auditStamp,
	createRecordValue,
	getPortfolioConfig,
	getRequired,
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	nextId,
	normalizePlanConfigRecord,
	runtimeRecord,
	validateModelUseConfigs,
	withTransaction,
} from './utils/storage'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	initialMessage: nonEmptyTrimmedStringPipe,
	config: planConfigPipe,
})
export type Input = PipeInput<typeof createPlanInputPipe>
type ValidatedInput = PipeOutput<typeof createPlanInputPipe>

export type Result = PlanWithPlanningAgentRun

export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError | AgentRunModelUseUnresolvedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

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
	modelUse: ModelUseConfig
	instruction: AgentRunInstruction
	initialMessage: string
	stamp: AuditStamp
	runtimeValues: CoreRuntimeValues
}

type DispatchedPlanCreation = {
	plan: PlanWithPlanningAgentRun
	dispatchMarker: string
}

async function handleCreatePlan(
	runtime: CoreRuntime,
	input: ValidatedInput,
	context: CommandContext,
): Promise<CoreResult<PlanWithPlanningAgentRun, Error>> {
	const values = planCreationRuntimeValues(runtime, context)
	if (!values.ok) return values

	const written = await withTransaction(runtime.services, (storage) => writePlan(runtime, storage, input, values.value))
	if (!written.ok) return written

	runtime.services.dispatcher.ready(written.value.dispatchMarker)
	return { ok: true, value: written.value.plan }
}

function planCreationRuntimeValues(
	runtime: CoreRuntime,
	context: CommandContext,
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
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: ValidatedInput,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const facts = await planCreationFacts(storage, input, values)
	return facts.ok ? writePlanCreationFacts(runtime, storage, facts.value) : facts
}

async function planCreationFacts(
	storage: CoreStorage,
	input: ValidatedInput,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, input.projectId)
	return project.ok ? planCreationFactsForProject(storage, input, values, project.value) : project
}

async function planCreationFactsForProject(
	storage: CoreStorage,
	input: ValidatedInput,
	values: PlanCreationRuntimeValues,
	project: Project,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const config = normalizePlanConfigRecord(input.config, values.stamp)
	const modelUse = await resolvePlanningModelUse(storage, values.planId, config, project)
	return modelUse.ok ? validatedPlanCreationFacts(storage, input, values, project, config, modelUse.value) : modelUse
}

async function validatedPlanCreationFacts(
	storage: CoreStorage,
	input: ValidatedInput,
	values: PlanCreationRuntimeValues,
	project: Project,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	modelUse: ModelUseConfig,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([modelUse]))
	if (!facts.ok) return facts

	const modelUseValidation = validateModelUseConfigs(facts.value, [modelUse])
	if (!modelUseValidation.ok) return modelUseValidation

	const instruction = planningInstructionForProject(project)
	return instruction.ok
		? { ok: true, value: planCreationFactsValue(input, values, project, config, modelUse, instruction.value) }
		: instruction
}

function planCreationFactsValue(
	input: ValidatedInput,
	values: PlanCreationRuntimeValues,
	project: Project,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	modelUse: ModelUseConfig,
	instruction: AgentRunInstruction,
): PlanCreationFacts {
	return {
		plan: { id: values.planId, projectId: project.id, title: input.title, config, created: values.stamp, closed: null },
		agentRunId: values.agentRunId,
		started: values.started,
		modelUse,
		instruction,
		initialMessage: input.initialMessage,
		stamp: values.stamp,
		runtimeValues: values.runtimeValues,
	}
}

async function writePlanCreationFacts(
	runtime: CoreRuntime,
	storage: CoreStorage,
	facts: PlanCreationFacts,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const storedPlan = await createRecordValue('plan', storage, facts.plan)
	return storedPlan.ok ? writePlanningAgentRun(runtime, storage, storedPlan.value, facts) : storedPlan
}

async function writePlanningAgentRun(
	runtime: CoreRuntime,
	storage: CoreStorage,
	plan: Plan,
	facts: PlanCreationFacts,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const storedAgentRun = await createModelAgentRunWithInitialModel({ values: facts.runtimeValues }, storage, {
		agentRunId: facts.agentRunId,
		purpose: { type: 'planning', planId: plan.id },
		started: facts.started,
		modelId: facts.modelUse.modelId,
		thinkingLevel: facts.modelUse.thinkingLevel,
	})
	return storedAgentRun.ok ? writePlanningInstruction(runtime, storage, plan, storedAgentRun.value, facts) : storedAgentRun
}

async function writePlanningInstruction(
	runtime: CoreRuntime,
	storage: CoreStorage,
	plan: Plan,
	agentRun: PlanWithPlanningAgentRun['agentRun'],
	facts: PlanCreationFacts,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const instruction = await appendAgentRunEvent({ values: facts.runtimeValues }, storage, agentRun.id, {
		type: 'instruction-snapshot',
		instruction: facts.instruction,
	})
	return instruction.ok ? writeInitialPlanningInput(runtime, storage, plan, agentRun, facts) : instruction
}

async function writeInitialPlanningInput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	plan: Plan,
	agentRun: PlanWithPlanningAgentRun['agentRun'],
	facts: PlanCreationFacts,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const input = await appendAgentRunEvent({ values: facts.runtimeValues }, storage, agentRun.id, {
		type: 'input-message',
		source: { type: 'operator', authorized: facts.stamp },
		content: [{ type: 'text', text: facts.initialMessage }],
	})
	if (!input.ok) return input

	const dispatchMarker = await acceptDispatchRequest(runtime.services.dispatcher, {
		type: 'agent-run',
		agentRunId: agentRun.id,
		serializationKey: agentRun.id,
		reason: { type: 'input-appended', inputEventId: input.value.id },
	})
	if (!dispatchMarker.ok) return dispatchMarker

	return { ok: true, value: { plan: { ...plan, agentRun }, dispatchMarker: dispatchMarker.value } }
}

async function resolvePlanningModelUse(
	storage: CoreStorage,
	planId: Id,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	project: Project,
): Promise<CoreResult<ModelUseConfig, Exclude<Error, InvalidInputError | ConfigCommandReferenceError>>> {
	const portfolioConfig = await getPortfolioConfig(storage)
	return portfolioConfig.ok ? resolvedPlanningModelUse(planId, config, project, portfolioConfig.value) : portfolioConfig
}

function resolvedPlanningModelUse(
	planId: Id,
	config: ReturnType<typeof normalizePlanConfigRecord>,
	project: Project,
	portfolioConfig: PortfolioConfigRecord | null,
): CoreResult<ModelUseConfig, AgentRunModelUseUnresolvedError> {
	const modelUse = firstPresent([
		planPlanningModelUse(config),
		projectPlanningModelUse(project),
		portfolioConfig?.value.model.planning,
		portfolioConfig?.value.model.default,
	])
	return modelUse === null ? agentRunModelUseUnresolved({ type: 'planning', planId }) : { ok: true, value: modelUse }
}

function planPlanningModelUse(config: ReturnType<typeof normalizePlanConfigRecord>): ModelUseConfig | null {
	return config?.value?.model?.planning ?? null
}

function projectPlanningModelUse(project: Project): ModelUseConfig | null {
	return project.config?.value?.model?.planning ?? null
}

function firstPresent<T>(values: Array<T | null | undefined>): T | null {
	return values.find((candidate): candidate is T => candidate !== null && candidate !== undefined) ?? null
}

function agentRunModelUseUnresolved(purpose: AgentRun['purpose']): CoreResult<never, AgentRunModelUseUnresolvedError> {
	return { ok: false, error: { type: 'agent-run-model-use-unresolved', purpose } }
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

			const result = await command({ projectId: 'project-1', title: 'Plan', initialMessage: ' ', config: { model: null } }, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'createPlan' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('requires Plan Config input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.' } as never, context)

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
					config: { model: { planning: null } },
				},
				context,
			)

			expect(result).toEqual({ ok: true, value: { ...expectedPlan(), agentRun: expectedPlanningAgentRun() } })
			expect(options.tx.plans.records.get('plan-1')).toEqual(expectedPlan())
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedPlanningAgentRun())
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toEqual({
				type: 'agent-run-model-selected',
				modelId: 'model-1',
				thinkingLevel: 'none',
				authorized: null,
			})
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')?.body).toMatchObject({
				type: 'instruction-snapshot',
				instruction: { type: 'source-control-planning', version: 1 },
			})
			expect(options.tx.agentRunEvents.records.get('agent-run-event-3')?.body).toEqual({
				type: 'input-message',
				source: { type: 'operator', authorized: localStamp() },
				content: [{ type: 'text', text: 'Please plan repository onboarding.' }],
			})
		})

		it('requests Agent Run Dispatch after appending the initial input message and readies it after commit', async () => {
			const dispatches: CoreDispatchRequest[] = []
			const readyMarkers: string[] = []
			const options = createTestCoreServices({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return Promise.resolve('marker-1')
					},
					ready: (marker) => {
						readyMarkers.push(marker)
					},
				},
			})
			seedProject(options.tx, 'project-1')
			seedSelectableModel(options.tx, 'model-1')
			options.tx.portfolioConfig.record = portfolioConfig('model-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{ projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.', config: { model: null } },
				context,
			)

			expect(result).toMatchObject({ ok: true })
			expect(dispatches).toEqual([
				{
					type: 'agent-run',
					agentRunId: 'agent-run-1',
					serializationKey: 'agent-run-1',
					reason: { type: 'input-appended', inputEventId: 'agent-run-event-3' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1'])
			expect(options.tx.agentRunEvents.records.get('agent-run-event-3')?.body.type).toBe('input-message')
		})

		it('rolls back Plan creation when dispatch request throws', async () => {
			const thrown = new Error('dispatch unavailable')
			const options = createTestCoreServices({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: () => Promise.reject(thrown),
					ready: () => {},
				},
			})

			const result = await runDispatchablePlanCreation(options)

			expect(transactionFailureCause(result)).toBe(thrown)
			expectPlanCreationRolledBack(options)
		})

		it('rolls back Plan creation when dispatch returns an invalid marker', async () => {
			const options = createTestCoreServices({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: () => Promise.resolve('   '),
					ready: () => {
						throw new Error('ready should not be called')
					},
				},
			})

			const result = await runDispatchablePlanCreation(options)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'dispatcher', operation: 'request' },
			})
			expectPlanCreationRolledBack(options)
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
						planning: { modelId: 'model-project', thinkingLevel: 'none' },
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
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
					config: { model: { planning: { modelId: 'model-plan', thinkingLevel: 'none' } } },
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

			const result = await command(
				{ projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.', config: { model: null } },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-model-use-unresolved', purpose: { type: 'planning', planId: 'plan-1' } },
			})
			expect(options.tx.plans.records.size).toBe(0)
			expect(options.tx.agentRuns.records.size).toBe(0)
		})
	})

	type CreatePlanCommandResult = Awaited<ReturnType<ReturnType<typeof createCreatePlanCommand>>>

	async function runDispatchablePlanCreation(options: ReturnType<typeof createTestCoreServices>): Promise<CreatePlanCommandResult> {
		seedProject(options.tx, 'project-1')
		seedSelectableModel(options.tx, 'model-1')
		options.tx.portfolioConfig.record = portfolioConfig('model-1')
		const command = createCreatePlanCommand(createTestCoreRuntime(options))
		return command(validPlanCreationInput(), context)
	}

	function validPlanCreationInput(): Input {
		return { projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.', config: { model: null } }
	}

	function transactionFailureCause(result: CreatePlanCommandResult): unknown {
		expect(result).toMatchObject({ ok: false, error: { type: 'storage-operation-failed', operation: { type: 'transaction' } } })
		if (!result.ok && result.error.type === 'storage-operation-failed' && result.error.operation.type === 'transaction') {
			return result.error.operation.cause
		}
		throw new Error('Expected transaction storage failure')
	}

	function expectPlanCreationRolledBack(options: ReturnType<typeof createTestCoreServices>): void {
		expect(options.tx.plans.records.size).toBe(0)
		expect(options.tx.agentRuns.records.size).toBe(0)
		expect(options.tx.agentRunEvents.records.size).toBe(0)
	}

	function expectedPlan(): Plan {
		return {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan setup',
			config: null,
			created: localStamp(),
			closed: null,
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
					default: { modelId: defaultModelId, thinkingLevel: 'none' },
					planning: planningModelId === null ? null : { modelId: planningModelId, thinkingLevel: 'none' },
					revisionPlanning: null,
					execution: null,
					revisionExecution: null,
				},
				work: null,
			},
		}
	}
}
