import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { freeFormStringPipe, idPipe, type AuditStamp, type Id } from '../domain/commons'
import type {
	AgentRunPurposeMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { getPendingProposalForAgentRunPurpose } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, getRequired, withTransaction } from './utils/storage'

const rejectPlanOutputInputPipe = v.object({ proposalEventId: idPipe, reason: v.nullable(freeFormStringPipe) })
export type Input = PipeOutput<typeof rejectPlanOutputInputPipe>

export type Result = AgentRunEvent

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ProposalAlreadyReviewedError
	| ProposalTypeMismatchError
	| AgentRunPurposeMismatchError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRejectPlanOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('rejectPlanOutput', rejectPlanOutputInputPipe, (input, context) =>
		handleRejectPlanOutput(runtime, input, context),
	)
}

async function handleRejectPlanOutput(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? withTransaction(runtime.services, (storage) => rejectPlanOutput(runtime, storage, input, stamp.value)) : stamp
}

async function rejectPlanOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const proposal = await loadRejectablePlanProposal(storage, input.proposalEventId)
	return proposal.ok
		? appendAgentRunEvent(runtime, storage, proposal.value.agentRunId, {
				type: 'proposal-rejected',
				proposalEventId: proposal.value.id,
				authorized: stamp,
				reason: input.reason,
			})
		: proposal
}

async function loadRejectablePlanProposal(
	storage: CoreStorage,
	proposalEventId: Id,
): Promise<CoreResult<AgentRunEvent, Exclude<Error, InvalidInputError>>> {
	const proposal = await getPendingProposalForAgentRunPurpose(storage, proposalEventId, 'proposed-plan-output', 'planning')
	if (!proposal.ok) return proposal

	const plan = await getRequired('plan', storage, proposal.value.agentRun.purpose.planId)
	return plan.ok ? { ok: true, value: proposal.value.proposal } : plan
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, stamp } = await import('../utils/test-helpers')

	describe('rejectPlanOutput command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunEvents.fail.get = true
			const command = createRejectPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'rejectPlanOutput' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('appends a proposal rejection for a pending Plan proposal', async () => {
			const options = proposalFixture()
			const command = createRejectPlanOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event', reason: 'Needs changes.' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-event-1',
					agentRunId: 'agent-run-1',
					sequence: 2,
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'proposal-rejected',
						proposalEventId: 'proposal-event',
						authorized: localStamp(),
						reason: 'Needs changes.',
					},
				},
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		seedProject(options.tx, 'project-1')
		options.tx.plans.records.set('plan-1', {
			id: 'plan-1',
			projectId: 'project-1',
			title: 'Plan',
			config: null,
			created: stamp,
			closed: null,
		})
		options.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			started: { at: stamp.at },
			completed: null,
		})
		options.tx.agentRunEvents.records.set('proposal-event', {
			id: 'proposal-event',
			agentRunId: 'agent-run-1',
			sequence: 1,
			occurred: { at: stamp.at },
			body: {
				type: 'proposed-plan-output',
				toolCallScheduledEventId: 'tool-call-1',
				output: { proposedDeliveries: [], proposedMemories: [] },
			},
		})
		return options
	}
}
