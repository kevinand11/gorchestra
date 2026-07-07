import { v, type PipeOutput } from 'valleyed'

import type { AgentRun, AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Plan, PlanWithPlanningAgentRun } from '../domain/plan'
import type {
	AgentRunTurnActiveError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	PlanClosedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { CommandContext } from './types'
import { listRecords, notFound } from '../storage/helpers'
import { completeAgentRunByPurposeAndAcceptSandboxRelease, getSingleAgentRunByPurpose } from '../utils/agent-runs'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, updateRecordValue, withAuditStampTransaction } from './utils/storage'

const closePlanInputPipe = v.object({ projectId: idPipe, planId: idPipe })
export type Input = PipeOutput<typeof closePlanInputPipe>

export type Result = PlanWithPlanningAgentRun
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| PlanClosedError
	| AgentRunTurnActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type DispatchedResult = { result: Result; dispatchMarker: string | null }

export function createClosePlanCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('closePlan', closePlanInputPipe, async (input, context) => {
		const written = await withAuditStampTransaction(runtime, context, (storage, stamp) => closePlan(runtime, storage, input, stamp))
		if (!written.ok) return written
		if (written.value.dispatchMarker !== null) runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.result }
	})
}

async function closePlan(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const plan = await getOpenProjectPlan(storage, input)
	if (!plan.ok) return plan

	const agentRun = await getSingleAgentRunByPurpose(storage, { type: 'planning', planId: plan.value.id })
	if (!agentRun.ok) return agentRun

	const idle = await requireAgentRunIdle(storage, agentRun.value.id)
	return idle.ok ? writeClosedPlan(runtime, storage, plan.value, stamp) : idle
}

async function getOpenProjectPlan(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<Plan, ResourceNotFoundError | StorageOperationFailedError | InvalidCoreServiceOutputError | PlanClosedError>> {
	const plan = await getRequired('plan', storage, input.planId)
	if (!plan.ok) return plan
	if (plan.value.projectId !== input.projectId) return notFound('plan', input.planId)
	return plan.value.closed === null ? { ok: true, value: plan.value } : planClosed(plan.value.id)
}

async function writeClosedPlan(
	runtime: CoreRuntime,
	storage: CoreStorage,
	plan: Plan,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const closedPlan = await updateRecordValue('plan', storage, plan.id, { closed: stamp })
	return closedPlan.ok ? completePlanningAgentRun(runtime, storage, closedPlan.value, stamp) : closedPlan
}

async function completePlanningAgentRun(
	runtime: CoreRuntime,
	storage: CoreStorage,
	plan: Plan,
	stamp: AuditStamp,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const completed = await completeAgentRunByPurposeAndAcceptSandboxRelease(
		storage,
		runtime.services.dispatcher,
		{ type: 'planning', planId: plan.id },
		{ at: stamp.at },
	)
	return completed.ok
		? {
				ok: true,
				value: {
					result: { ...plan, agentRun: completed.value.agentRun as PlanWithPlanningAgentRun['agentRun'] },
					dispatchMarker: completed.value.dispatchMarker,
				},
			}
		: completed
}

async function requireAgentRunIdle(
	storage: CoreStorage,
	agentRunId: Id,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | StorageOperationFailedError | AgentRunTurnActiveError>> {
	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'id', direction: 'asc' }],
	})
	return events.ok ? activeTurn(events.value) : events
}

function activeTurn(events: AgentRunEvent[]): CoreResult<void, AgentRunTurnActiveError> {
	const started = [...events].reverse().find((event) => event.body.type === 'turn-started')
	if (started === undefined || started.body.type !== 'turn-started') return { ok: true, value: undefined }

	const ended = events.some(
		(event) => event.id > started.id && event.body.type === 'turn-ended' && event.body.turnStartedEventId === started.id,
	)
	return ended ? { ok: true, value: undefined } : agentRunTurnActive(started.agentRunId, started.id)
}

function agentRunTurnActive(agentRunId: Id, turnStartedEventId: Id): CoreResult<never, AgentRunTurnActiveError> {
	return { ok: false, error: { type: 'agent-run-turn-active', agentRunId, turnStartedEventId } }
}

function planClosed(planId: Id): CoreResult<never, PlanClosedError> {
	return { ok: false, error: { type: 'plan-closed', planId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedProject, stamp } =
		await import('../utils/test-helpers')

	describe('closePlan command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.plans.fail.get = true
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'closePlan' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('closes an open Plan and completes its Planning Agent Run', async () => {
			const options = closePlanFixture()
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: '01k00000000000000000000030', planId: '01k00000000000000000000028' }, context)

			const expectedPlan = { ...plan(), closed: localStamp() }
			const expectedAgentRun = { ...planningAgentRun(), completed: { at: localStamp().at } }
			expect(result).toEqual({ ok: true, value: { ...expectedPlan, agentRun: expectedAgentRun } })
			expect(options.tx.plans.records.get('01k00000000000000000000028')).toEqual(expectedPlan)
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toEqual(expectedAgentRun)
		})

		it('closes the Plan without overwriting an already completed Planning Agent Run', async () => {
			const options = closePlanFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.completed = previousCompletion
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: '01k00000000000000000000030', planId: '01k00000000000000000000028' }, context)

			expect(result).toMatchObject({ ok: true, value: { agentRun: { completed: previousCompletion } } })
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.completed).toEqual(previousCompletion)
		})

		it('rejects closed Plans', async () => {
			const options = closePlanFixture()
			options.tx.plans.records.get('01k00000000000000000000028')!.closed = localStamp()
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: '01k00000000000000000000030', planId: '01k00000000000000000000028' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'plan-closed', planId: '01k00000000000000000000028' } })
		})

		it('returns not-found for Plans outside the Project boundary', async () => {
			const options = closePlanFixture()
			seedProject(options.tx, '01k00000000000000000000031')
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: '01k00000000000000000000031', planId: '01k00000000000000000000028' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'plan', id: '01k00000000000000000000028' } })
		})

		it('rejects Plans whose Planning Agent Run has an unmatched active turn', async () => {
			const options = closePlanFixture()
			options.tx.agentRunEvents.records.set('turn-started', {
				id: 'turn-started',
				agentRunId: '01k00000000000000000000002',
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'turn-started',
					contextThroughEventId: '01j00000000000000000000000',
					reason: { type: 'input', inputEventIds: ['01j00000000000000000000000'] },
				},
			})
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: '01k00000000000000000000030', planId: '01k00000000000000000000028' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-turn-active', agentRunId: '01k00000000000000000000002', turnStartedEventId: 'turn-started' },
			})
			expect(options.tx.plans.records.get('01k00000000000000000000028')?.closed).toBeNull()
		})
	})

	function closePlanFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, '01k00000000000000000000030')
		options.tx.plans.records.set('01k00000000000000000000028', plan())
		options.tx.agentRuns.records.set('01k00000000000000000000002', planningAgentRun())
		return options
	}

	function plan(): Plan {
		return {
			id: '01k00000000000000000000028',
			projectId: '01k00000000000000000000030',
			title: 'Plan',
			created: stamp,
			closed: null,
		}
	}

	function planningAgentRun(): AgentRun {
		return {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: '01k00000000000000000000028' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
