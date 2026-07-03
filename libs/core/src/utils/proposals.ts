import type { AgentRun, AgentRunEvent } from '../domain/agent-run'
import type { Id } from '../domain/commons'
import type {
	AgentRunPurposeMismatchError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
} from '../errors'
import type { CoreStorage } from '../services'
import type { Result } from './types'
import { getRequired, listRecords, type StorageBoundaryError } from '../storage/helpers'

export type ProposalReviewState =
	| { type: 'pending' }
	| { type: 'accepted'; event: AgentRunEvent }
	| { type: 'rejected'; event: AgentRunEvent }

export type ProposalEventType = 'proposed-plan-output' | 'proposed-revision-output'
export type ProposalReviewBodyType = 'proposal-accepted' | 'proposal-rejected'
type AgentRunWithPurpose<TExpected extends AgentRun['purpose']['type']> = AgentRun & {
	purpose: Extract<AgentRun['purpose'], { type: TExpected }>
}
export type AgentRunEventWithBody<TExpected extends AgentRunEvent['body']['type']> = AgentRunEvent & {
	body: Extract<AgentRunEvent['body'], { type: TExpected }>
}

export interface PendingProposalForPurpose<TProposalType extends ProposalEventType, TPurposeType extends AgentRun['purpose']['type']> {
	proposal: AgentRunEventWithBody<TProposalType>
	agentRun: AgentRunWithPurpose<TPurposeType>
}

export async function getPendingProposalForAgentRunPurpose<
	TProposalType extends ProposalEventType,
	TPurposeType extends AgentRun['purpose']['type'],
>(
	storage: CoreStorage,
	proposalEventId: Id,
	proposalType: TProposalType,
	purposeType: TPurposeType,
): Promise<
	Result<
		PendingProposalForPurpose<TProposalType, TPurposeType>,
		| StorageBoundaryError
		| ResourceNotFoundError
		| InvariantViolationError
		| ProposalAlreadyReviewedError
		| ProposalTypeMismatchError
		| AgentRunPurposeMismatchError
	>
> {
	const proposal = await getTypedPendingProposal(storage, proposalEventId, proposalType)
	return proposal.ok ? loadProposalAgentRun(storage, proposal.value, purposeType) : proposal
}

export async function getProposalEvent(
	storage: CoreStorage,
	proposalEventId: Id,
): Promise<Result<AgentRunEvent, StorageBoundaryError | ResourceNotFoundError>> {
	return getRequired('agent-run-event', storage, proposalEventId)
}

export async function deriveProposalReviewState(
	storage: CoreStorage,
	proposal: AgentRunEvent,
): Promise<Result<ProposalReviewState, StorageBoundaryError | InvariantViolationError>> {
	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, proposal.agentRunId),
	})
	return events.ok ? proposalReviewState(proposal, events.value) : events
}

async function getTypedPendingProposal<TProposalType extends ProposalEventType>(
	storage: CoreStorage,
	proposalEventId: Id,
	proposalType: TProposalType,
): Promise<
	Result<
		AgentRunEventWithBody<TProposalType>,
		StorageBoundaryError | ResourceNotFoundError | InvariantViolationError | ProposalAlreadyReviewedError | ProposalTypeMismatchError
	>
> {
	const proposal = await getProposalEvent(storage, proposalEventId)
	if (!proposal.ok) return proposal

	const typed = requireProposalType(proposal.value, proposalType)
	if (!typed.ok) return typed

	const pending = await requirePendingProposal(storage, proposal.value)
	return pending.ok ? typed : pending
}

async function loadProposalAgentRun<TProposalType extends ProposalEventType, TPurposeType extends AgentRun['purpose']['type']>(
	storage: CoreStorage,
	proposal: AgentRunEventWithBody<TProposalType>,
	purposeType: TPurposeType,
): Promise<
	Result<
		PendingProposalForPurpose<TProposalType, TPurposeType>,
		StorageBoundaryError | ResourceNotFoundError | AgentRunPurposeMismatchError
	>
> {
	const agentRun = await getRequired('agent-run', storage, proposal.agentRunId)
	if (!agentRun.ok) return agentRun

	const typedAgentRun = requireAgentRunPurpose(agentRun.value, purposeType)
	return typedAgentRun.ok ? { ok: true, value: { proposal, agentRun: typedAgentRun.value } } : typedAgentRun
}

export async function requirePendingProposal(
	storage: CoreStorage,
	proposal: AgentRunEvent,
): Promise<Result<void, StorageBoundaryError | InvariantViolationError | ProposalAlreadyReviewedError>> {
	const state = await deriveProposalReviewState(storage, proposal)
	if (!state.ok) return state

	return state.value.type === 'pending' ? ok() : proposalAlreadyReviewed(proposal.id)
}

export function requireProposalType<TExpected extends ProposalEventType>(
	proposal: AgentRunEvent,
	expected: TExpected,
): Result<AgentRunEventWithBody<TExpected>, ProposalTypeMismatchError> {
	return proposal.body.type === expected
		? { ok: true, value: proposal as AgentRunEventWithBody<TExpected> }
		: proposalTypeMismatch(proposal, expected)
}

export function requireAgentRunPurpose<TExpected extends AgentRun['purpose']['type']>(
	agentRun: AgentRun,
	expected: TExpected,
): Result<AgentRunWithPurpose<TExpected>, AgentRunPurposeMismatchError> {
	return agentRun.purpose.type === expected
		? { ok: true, value: agentRun as AgentRunWithPurpose<TExpected> }
		: agentRunPurposeMismatch(agentRun, [expected])
}

function proposalReviewState(proposal: AgentRunEvent, events: AgentRunEvent[]): Result<ProposalReviewState, InvariantViolationError> {
	const terminal = events.filter((event) => isReviewForProposal(proposal, event))
	if (terminal.length === 0) return { ok: true, value: { type: 'pending' } }
	if (terminal.length > 1) return invariant(`Proposal Event ${proposal.id} has multiple terminal reviews.`)

	return terminal[0]!.body.type === 'proposal-accepted'
		? { ok: true, value: { type: 'accepted', event: terminal[0]! } }
		: { ok: true, value: { type: 'rejected', event: terminal[0]! } }
}

function isReviewForProposal(proposal: AgentRunEvent, event: AgentRunEvent): boolean {
	return event.cursor > proposal.cursor && isProposalReviewBody(event.body) && event.body.proposalCursor === proposal.cursor
}

function isProposalReviewBody(body: AgentRunEvent['body']): body is Extract<AgentRunEvent['body'], { type: ProposalReviewBodyType }> {
	return body.type === 'proposal-accepted' || body.type === 'proposal-rejected'
}

function proposalAlreadyReviewed(proposalEventId: Id): Result<never, ProposalAlreadyReviewedError> {
	return { ok: false, error: { type: 'proposal-already-reviewed', proposalEventId } }
}

function proposalTypeMismatch(proposal: AgentRunEvent, expected: ProposalEventType): Result<never, ProposalTypeMismatchError> {
	return { ok: false, error: { type: 'proposal-type-mismatch', proposalEventId: proposal.id, expected, actual: proposal.body.type } }
}

function agentRunPurposeMismatch(agentRun: AgentRun, expected: AgentRun['purpose']['type'][]): Result<never, AgentRunPurposeMismatchError> {
	return { ok: false, error: { type: 'agent-run-purpose-mismatch', agentRunId: agentRun.id, expected, actual: agentRun.purpose } }
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

function ok(): Result<void, never> {
	return { ok: true, value: undefined }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp } = await import('./test-helpers')

	describe('deriveProposalReviewState', () => {
		it('derives pending, accepted, rejected, and corrupt multiple-review states', async () => {
			const pending = proposalFixture()
			await expect(deriveProposalReviewState(pending.storage, pending.proposal)).resolves.toEqual({
				ok: true,
				value: { type: 'pending' },
			})

			const accepted = proposalFixture()
			const acceptedEvent = reviewEvent('agent-run-event-2', 'proposal-accepted')
			accepted.tx.agentRunEvents.records.set(acceptedEvent.id, acceptedEvent)
			await expect(deriveProposalReviewState(accepted.storage, accepted.proposal)).resolves.toEqual({
				ok: true,
				value: { type: 'accepted', event: acceptedEvent },
			})

			const rejected = proposalFixture()
			const rejectedEvent = reviewEvent('agent-run-event-2', 'proposal-rejected')
			rejected.tx.agentRunEvents.records.set(rejectedEvent.id, rejectedEvent)
			await expect(deriveProposalReviewState(rejected.storage, rejected.proposal)).resolves.toEqual({
				ok: true,
				value: { type: 'rejected', event: rejectedEvent },
			})

			const corrupt = proposalFixture()
			corrupt.tx.agentRunEvents.records.set('agent-run-event-2', reviewEvent('agent-run-event-2', 'proposal-accepted'))
			corrupt.tx.agentRunEvents.records.set('agent-run-event-3', reviewEvent('agent-run-event-3', 'proposal-rejected', 3))
			await expect(deriveProposalReviewState(corrupt.storage, corrupt.proposal)).resolves.toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Proposal Event agent-run-event-1 has multiple terminal reviews.' },
			})
		})
	})

	function proposalFixture() {
		const options = createTestCoreServices()
		const proposal = proposalEvent()
		options.tx.agentRunEvents.records.set(proposal.id, proposal)
		return { ...options, proposal }
	}

	function proposalEvent(): AgentRunEvent {
		return {
			id: 'agent-run-event-1',
			agentRunId: 'agent-run-1',
			cursor: '01J00000000000000000000001',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'proposed-plan-output',
				toolCallStartedCursor: '01J00000000000000000000000',
				output: {
					proposedDeliveries: {},
					proposedMemoryCreations: { memory: { parentId: null, title: 'Memory', body: '', children: {} } },
					proposedMemoryRevisions: {},
				},
			},
		}
	}

	function reviewEvent(id: string, type: ProposalReviewBodyType, sequence = 2): AgentRunEvent {
		return {
			id,
			agentRunId: 'agent-run-1',
			cursor: `01J000000000000000000${sequence.toString().padStart(5, '0')}`,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body:
				type === 'proposal-accepted'
					? {
							type,
							proposalCursor: '01J00000000000000000000001',
							authorized: localStamp(),
							materialized: {
								type: 'plan-output',
								deliveryIds: [],
								sliceIds: [],
								memoryIds: [],
								memoryRevisionIds: [],
								linkIds: [],
							},
						}
					: { type, proposalCursor: '01J00000000000000000000001', authorized: localStamp(), reason: null },
		}
	}
}
