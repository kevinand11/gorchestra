import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunInstruction } from '../domain/agent-run'
import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type RuntimeRecord } from '../domain/commons'
import type { Plan, PlanWithPlanningAgentRun } from '../domain/plan'
import type { Project } from '../domain/project'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { planningInstructionForProject } from '../runtime/agent-runs/instructions'
import type { CoreDispatchRequest, CoreStorage } from '../services'
import { appendAgentRunEvent, createModelAgentRunWithProfileSnapshot } from '../utils/agent-run-events'
import type { CoreRuntimeValues } from '../utils/runtime-values'
import type { Result as CoreResult } from '../utils/types'
import { acceptAgentRunModelTurn, acceptAgentRunSandboxPreparation } from './utils/dispatch'
import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	agentRunProfileSnapshot,
	auditStamp,
	createRecordValue,
	getRequired,
	loadSelectableAgentRunProfile,
	nextId,
	runtimeRecord,
	withTransaction,
} from './utils/storage'

const createPlanInputPipe = v.object({
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	initialMessage: nonEmptyTrimmedStringPipe,
	agentRunProfileId: idPipe,
})
export type Input = PipeOutput<typeof createPlanInputPipe>

export type Result = PlanWithPlanningAgentRun
export type Error = InvalidInputError | ConfigCommandReferenceError | ConfigCommandStorageError
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
	profile: ReturnType<typeof agentRunProfileSnapshot>
	instruction: AgentRunInstruction
	initialMessage: string
	stamp: AuditStamp
	runtimeValues: CoreRuntimeValues
}

type DispatchedPlanCreation = {
	plan: PlanWithPlanningAgentRun
	dispatchMarkers: string[]
}

async function handleCreatePlan(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<PlanWithPlanningAgentRun, Error>> {
	const values = planCreationRuntimeValues(runtime, context)
	if (!values.ok) return values

	const written = await withTransaction(runtime.services, (storage) => writePlan(runtime, storage, input, values.value))
	if (!written.ok) return written

	for (const dispatchMarker of written.value.dispatchMarkers) runtime.services.dispatcher.ready(dispatchMarker)
	return { ok: true, value: written.value.plan }
}

function planCreationRuntimeValues(
	runtime: CoreRuntime,
	context: CommandContext,
): CoreResult<PlanCreationRuntimeValues, ConfigCommandStorageError> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const planId = nextId(runtime.values, 'plan')
	if (!planId.ok) return planId

	const agentRunId = nextId(runtime.values, 'agent-run')
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(runtime.values)
	return started.ok
		? {
				ok: true,
				value: {
					stamp: stamp.value,
					planId: planId.value,
					agentRunId: agentRunId.value,
					started: started.value,
					runtimeValues: runtime.values,
				},
			}
		: started
}

async function writePlan(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<DispatchedPlanCreation, Exclude<Error, InvalidInputError>>> {
	const facts = await planCreationFacts(storage, input, values)
	return facts.ok ? writePlanCreationFacts(runtime, storage, facts.value) : facts
}

async function planCreationFacts(
	storage: CoreStorage,
	input: Input,
	values: PlanCreationRuntimeValues,
): Promise<CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>>> {
	const project = await getRequired('project', storage, input.projectId)
	if (!project.ok) return project

	const profile = await loadSelectableAgentRunProfile(storage, input.agentRunProfileId)
	return profile.ok ? validatedPlanCreationFacts(input, values, project.value, agentRunProfileSnapshot(profile.value)) : profile
}

function validatedPlanCreationFacts(
	input: Input,
	values: PlanCreationRuntimeValues,
	project: Project,
	profile: ReturnType<typeof agentRunProfileSnapshot>,
): CoreResult<PlanCreationFacts, Exclude<Error, InvalidInputError>> {
	const instruction = planningInstructionForProject(project)
	return instruction.ok ? { ok: true, value: planCreationFactsValue(input, values, project, profile, instruction.value) } : instruction
}

function planCreationFactsValue(
	input: Input,
	values: PlanCreationRuntimeValues,
	project: Project,
	profile: ReturnType<typeof agentRunProfileSnapshot>,
	instruction: AgentRunInstruction,
): PlanCreationFacts {
	return {
		plan: { id: values.planId, projectId: project.id, title: input.title, created: values.stamp, closed: null },
		agentRunId: values.agentRunId,
		started: values.started,
		profile,
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
	const storedAgentRun = await createModelAgentRunWithProfileSnapshot(storage, {
		agentRunId: facts.agentRunId,
		purpose: { type: 'planning', planId: plan.id },
		started: facts.started,
		profile: facts.profile,
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

	const preparationDispatchMarker = await acceptAgentRunSandboxPreparation(runtime.services.dispatcher, agentRun.id, {
		type: 'agent-run-created',
	})
	if (!preparationDispatchMarker.ok) return preparationDispatchMarker

	const modelTurnDispatchMarker = await acceptAgentRunModelTurn(runtime.services.dispatcher, agentRun.id, input.value.id)
	if (!modelTurnDispatchMarker.ok) return modelTurnDispatchMarker

	return {
		ok: true,
		value: { plan: { ...plan, agentRun }, dispatchMarkers: [preparationDispatchMarker.value, modelTurnDispatchMarker.value] },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedAgentRunProfile, seedProject } =
		await import('../utils/test-helpers')

	describe('createPlan command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{ projectId: 'project-1', title: 'Plan', initialMessage: ' ', agentRunProfileId: 'profile-1' },
				context,
			)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'createPlan' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a Plan and Planning Agent Run with the selected profile snapshot', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: 'project-1',
					title: '  Plan setup  ',
					initialMessage: '  Please plan repository onboarding.  ',
					agentRunProfileId: 'agent-run-profile-1',
				},
				context,
			)

			expect(result).toEqual({ ok: true, value: { ...expectedPlan(), agentRun: expectedPlanningAgentRun() } })
			expect(options.tx.plans.records.get('plan-1')).toEqual(expectedPlan())
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedPlanningAgentRun())
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toMatchObject({
				type: 'instruction-snapshot',
				instruction: { type: 'source-control-planning', version: 1 },
			})
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')?.body).toEqual({
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
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1')
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(validPlanCreationInput(), context)

			expect(result).toMatchObject({ ok: true })
			expect(dispatches).toEqual([
				{
					type: 'agent-run-sandbox-preparation',
					agentRunId: 'agent-run-1',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: 'agent-run-1' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'agent-run-created' },
				},
				{
					type: 'agent-run-model-turn',
					agentRunId: 'agent-run-1',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: 'agent-run-1' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'input-appended', inputEventId: 'agent-run-event-2' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1', 'marker-1'])
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')?.body.type).toBe('input-message')
		})

		it('rejects archived selected profiles', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedAgentRunProfile(options.tx, 'agent-run-profile-1', 'model-1', { archived: true })
			const command = createCreatePlanCommand(createTestCoreRuntime(options))

			const result = await command(validPlanCreationInput(), context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'archived-agent-run-profile-reference', agentRunProfileId: 'agent-run-profile-1' },
			})
			expect(options.tx.plans.records.size).toBe(0)
			expect(options.tx.agentRuns.records.size).toBe(0)
		})
	})

	function validPlanCreationInput(): Input {
		return { projectId: 'project-1', title: 'Plan', initialMessage: 'Plan this.', agentRunProfileId: 'agent-run-profile-1' }
	}

	function expectedPlan(): Plan {
		return {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan setup',
			created: localStamp(),
			closed: null,
		}
	}

	function expectedPlanningAgentRun(): PlanWithPlanningAgentRun['agentRun'] {
		return {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Agent Run Profile',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				runtimeRequirements: [],
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
			sandbox: { assignment: null, appliedRequirements: [], appliedThroughCursor: null, released: null },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
