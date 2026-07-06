import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { freeFormStringPipe, idPipe, type AuditStamp, type Id } from '../domain/commons'
import type {
	AgentRunNotActiveError,
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
import { getPendingProposalForAgentRunPurpose, proposalRejectedProjectedParts } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, getRequired, withTransaction } from './utils/storage'

const rejectRevisionOutputInputPipe = v.object({ proposalEventId: idPipe, reason: v.nullable(freeFormStringPipe) })
export type Input = PipeOutput<typeof rejectRevisionOutputInputPipe>

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
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createRejectRevisionOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('rejectRevisionOutput', rejectRevisionOutputInputPipe, (input, context) =>
		handleRejectRevisionOutput(runtime, input, context),
	)
}

async function handleRejectRevisionOutput(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? withTransaction(runtime.services, (storage) => rejectRevisionOutput(runtime, storage, input, stamp.value)) : stamp
}

async function rejectRevisionOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const proposal = await loadRejectableRevisionProposal(storage, input.proposalEventId)
	return proposal.ok
		? appendAgentRunEvent(runtime, storage, proposal.value.agentRunId, {
				type: 'proposal-rejected',
				proposalCursor: proposal.value.cursor,
				authorized: stamp,
				reason: input.reason,
				projectedParts: proposalRejectedProjectedParts(proposal.value.cursor, input.reason),
			})
		: proposal
}

async function loadRejectableRevisionProposal(
	storage: CoreStorage,
	proposalEventId: Id,
): Promise<CoreResult<AgentRunEvent, Exclude<Error, InvalidInputError>>> {
	const proposal = await getPendingProposalForAgentRunPurpose(storage, proposalEventId, 'proposed-revision-output', 'revision-planning')
	if (!proposal.ok) return proposal

	const gate = await getRequired('revision-gate', storage, proposal.value.agentRun.purpose.revisionGateId)
	if (!gate.ok) return gate

	return gate.value.closed === null ? { ok: true, value: proposal.value.proposal } : agentRunNotActive(proposal.value.agentRun.id)
}

function agentRunNotActive(agentRunId: Id): CoreResult<never, AgentRunNotActiveError> {
	return { ok: false, error: { type: 'agent-run-not-active', agentRunId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('rejectRevisionOutput command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunEvents.fail.get = true
			const command = createRejectRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'rejectRevisionOutput' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('appends a proposal rejection for a pending Revision proposal', async () => {
			const options = proposalFixture()
			const command = createRejectRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event', reason: 'Needs changes.' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-event-1',
					agentRunId: 'agent-run-1',
					cursor: '01J00000000000000000000001',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'proposal-rejected',
						proposalCursor: '01J00000000000000000000000',
						authorized: localStamp(),
						reason: 'Needs changes.',
						projectedParts: [
							{ type: 'text', text: 'Proposal 01J00000000000000000000000 rejected. Needs changes.', metadata: null },
						],
					},
				},
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		options.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: 'revision-gate-1' },
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
			started: { at: stamp.at },
			completed: null,
		})
		options.tx.revisionGates.records.set('revision-gate-1', {
			id: 'revision-gate-1',
			scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		})
		options.tx.agentRunEvents.records.set('proposal-event', {
			id: 'proposal-event',
			agentRunId: 'agent-run-1',
			cursor: '01J00000000000000000000000',
			occurred: { at: stamp.at },
			body: {
				type: 'proposed-revision-output',
				assistantMessageCursor: '01J00000000000000000000000',
				toolCallId: 'call-1',
				output: { instruction: { body: 'Revise.' }, disposition: { body: 'Because.' } },
			},
		})
		return options
	}
}
