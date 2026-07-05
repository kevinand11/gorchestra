import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
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
import { listRecords, notFound } from '../storage/helpers'
import { getSingleAgentRunByPurpose } from '../utils/agent-runs'
import { completeAgentRunByPurposeAndAcceptSandboxRelease } from './utils/dispatch'
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
		orderBy: [{ field: 'cursor', direction: 'asc' }],
	})
	return events.ok ? activeTurn(events.value) : events
}

function activeTurn(events: AgentRunEvent[]): CoreResult<void, AgentRunTurnActiveError> {
	const started = [...events].reverse().find((event) => event.body.type === 'turn-started')
	if (started === undefined || started.body.type !== 'turn-started') return { ok: true, value: undefined }

	const ended = events.some(
		(event) => event.cursor > started.cursor && event.body.type === 'turn-ended' && event.body.turnStartedCursor === started.cursor,
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
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, stamp } = await import('../utils/test-helpers')

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

			const result = await command({ projectId: 'project-1', planId: 'plan-1' }, context)

			const expectedPlan = { ...plan(), closed: localStamp() }
			const expectedAgentRun = { ...planningAgentRun(), completed: { at: localStamp().at } }
			expect(result).toEqual({ ok: true, value: { ...expectedPlan, agentRun: expectedAgentRun } })
			expect(options.tx.plans.records.get('plan-1')).toEqual(expectedPlan)
			expect(options.tx.agentRuns.records.get('agent-run-1')).toEqual(expectedAgentRun)
		})

		it('closes the Plan without overwriting an already completed Planning Agent Run', async () => {
			const options = closePlanFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('agent-run-1')!.completed = previousCompletion
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', planId: 'plan-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { agentRun: { completed: previousCompletion } } })
			expect(options.tx.agentRuns.records.get('agent-run-1')?.completed).toEqual(previousCompletion)
		})

		it('rejects closed Plans', async () => {
			const options = closePlanFixture()
			options.tx.plans.records.get('plan-1')!.closed = localStamp()
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', planId: 'plan-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'plan-closed', planId: 'plan-1' } })
		})

		it('returns not-found for Plans outside the Project boundary', async () => {
			const options = closePlanFixture()
			seedProject(options.tx, 'project-2')
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-2', planId: 'plan-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'plan', id: 'plan-1' } })
		})

		it('rejects Plans whose Planning Agent Run has an unmatched active turn', async () => {
			const options = closePlanFixture()
			options.tx.agentRunEvents.records.set('turn-started', {
				id: 'turn-started',
				agentRunId: 'agent-run-1',
				cursor: '01J00000000000000000000001',
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: { type: 'turn-started', contextThroughCursor: null, reason: { type: 'input', inputEventCursors: [] } },
			})
			const command = createClosePlanCommand(createTestCoreRuntime(options))

			const result = await command({ projectId: 'project-1', planId: 'plan-1' }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-turn-active', agentRunId: 'agent-run-1', turnStartedEventId: 'turn-started' },
			})
			expect(options.tx.plans.records.get('plan-1')?.closed).toBeNull()
		})
	})

	function closePlanFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		options.tx.plans.records.set('plan-1', plan())
		options.tx.agentRuns.records.set('agent-run-1', planningAgentRun())
		return options
	}

	function plan(): Plan {
		return {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan',
			created: stamp,
			closed: null,
		}
	}

	function planningAgentRun(): AgentRun {
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
			blocked: null,
			sandbox: { assignment: null, appliedRequirements: [], appliedThroughCursor: null, released: null },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		}
	}
}
