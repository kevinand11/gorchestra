import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { ReviewSurface, ReviewSurfaceScope } from '../domain/review-surface'
import type { Revision, RevisionGate, RevisionOutputProposal, RevisionScope } from '../domain/revision'
import type {
	AgentRunPurposeMismatchError,
	DeliveryClosedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ProposalAlreadyReviewedError,
	ProposalTypeMismatchError,
	ResourceNotFoundError,
	ReviewSurfaceAlreadyMergedError,
	RevisionGateClosedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { getPendingProposalForAgentRunPurpose } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
import { completeAgentRunByPurposeAndAcceptSandboxRelease } from './utils/dispatch'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, listRecords, nextId, updateRecordValue, withTransaction } from './utils/storage'

const acceptRevisionOutputInputPipe = v.object({ proposalEventId: idPipe })
export type Input = PipeOutput<typeof acceptRevisionOutputInputPipe>

export interface Result {
	revision: Revision
	revisionGate: RevisionGate
	acceptedEvent: AgentRunEvent
}

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| RevisionGateClosedError
	| DeliveryClosedError
	| ReviewSurfaceAlreadyMergedError
	| ProposalAlreadyReviewedError
	| ProposalTypeMismatchError
	| AgentRunPurposeMismatchError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type DispatchedResult = { result: Result; dispatchMarker: string | null }

export function createAcceptRevisionOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('acceptRevisionOutput', acceptRevisionOutputInputPipe, (input, context) =>
		handleAcceptRevisionOutput(runtime, input, context),
	)
}

async function handleAcceptRevisionOutput(
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const revisionId = nextId(runtime.values, 'revision')
	if (!revisionId.ok) return revisionId

	const written = await withTransaction(runtime.services, (storage) =>
		acceptRevisionOutput(runtime, storage, input, stamp.value, revisionId.value),
	)
	if (!written.ok) return written
	if (written.value.dispatchMarker !== null) runtime.services.dispatcher.ready(written.value.dispatchMarker)
	return { ok: true, value: written.value.result }
}

interface RevisionProposalContext {
	proposal: AgentRunEvent & { body: Extract<AgentRunEvent['body'], { type: 'proposed-revision-output' }> }
	gate: RevisionGate
	output: RevisionOutputProposal
}

async function acceptRevisionOutput(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	revisionId: Id,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const context = await revisionProposalContext(storage, input.proposalEventId)
	return context.ok ? acceptForGate(runtime, storage, context.value, stamp, revisionId) : context
}

async function revisionProposalContext(
	storage: CoreStorage,
	proposalEventId: Id,
): Promise<CoreResult<RevisionProposalContext, Exclude<Error, InvalidInputError>>> {
	const proposal = await getPendingProposalForAgentRunPurpose(storage, proposalEventId, 'proposed-revision-output', 'revision-planning')
	if (!proposal.ok) return proposal

	const gate = await getRequired('revision-gate', storage, proposal.value.agentRun.purpose.revisionGateId)
	return gate.ok
		? { ok: true, value: { proposal: proposal.value.proposal, gate: gate.value, output: proposal.value.proposal.body.output } }
		: gate
}

async function acceptForGate(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revisionId: Id,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	if (context.gate.closed !== null) return revisionGateClosed(context.gate.id)

	const existingRevision = await validateNoRevisionForGate(storage, context.gate.id)
	if (!existingRevision.ok) return existingRevision

	const scopeValidation = await validateGateScope(storage, context.gate)
	return scopeValidation.ok ? writeAcceptedRevision(runtime, storage, context, stamp, revisionId) : scopeValidation
}

async function validateNoRevisionForGate(
	storage: CoreStorage,
	revisionGateId: Id,
): Promise<CoreResult<void, StorageOperationFailedError | InvalidCoreServiceOutputError | InvariantViolationError>> {
	const revisions = await listRecords('revision', storage, {
		where: (filter, fields) => filter.eq(fields.revisionGateId, revisionGateId),
	})
	if (!revisions.ok) return revisions

	return revisions.value.length > 0
		? invariant(`Revision Gate ${revisionGateId} already has a Revision.`)
		: { ok: true, value: undefined }
}

async function validateGateScope(storage: CoreStorage, gate: RevisionGate): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const reviewSurface = await getRequired('review-surface', storage, gate.reviewSurfaceId)
	if (!reviewSurface.ok) return reviewSurface

	const reviewSurfaceValidation = validateReviewSurfaceForGate(gate, reviewSurface.value)
	return reviewSurfaceValidation.ok ? validateRevisionScopeRecords(storage, gate.scope) : reviewSurfaceValidation
}

function validateReviewSurfaceForGate(
	gate: RevisionGate,
	reviewSurface: ReviewSurface,
): CoreResult<void, InvariantViolationError | ReviewSurfaceAlreadyMergedError> {
	const scopeValidation = validateReviewSurfaceScope(gate, reviewSurface)
	return scopeValidation.ok ? validateReviewSurfaceNotMerged(reviewSurface) : scopeValidation
}

function validateReviewSurfaceScope(gate: RevisionGate, reviewSurface: ReviewSurface): CoreResult<void, InvariantViolationError> {
	return revisionScopeKey(gate.scope) === reviewSurfaceScopeKey(reviewSurface.scope)
		? ok()
		: invariant(`Revision Gate ${gate.id} scope does not match Review Surface ${reviewSurface.id}.`)
}

function validateReviewSurfaceNotMerged(reviewSurface: ReviewSurface): CoreResult<void, ReviewSurfaceAlreadyMergedError> {
	return reviewSurface.closed?.type === 'merged' ? reviewSurfaceAlreadyMerged(reviewSurface.id) : ok()
}

function validateRevisionScopeRecords(
	storage: CoreStorage,
	scope: RevisionScope,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return scope.type === 'delivery-artifact' ? validateDeliveryRevisionScope(storage, scope) : validateSliceRevisionScope(storage, scope)
}

async function validateDeliveryRevisionScope(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'delivery-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const delivery = await getRequired('delivery', storage, scope.deliveryId)
	return delivery.ok ? validateDeliveryRevisionArtifact(storage, scope, delivery.value) : delivery
}

async function validateDeliveryRevisionArtifact(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'delivery-artifact' }>,
	delivery: Delivery,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const artifact = await getRequired('delivery-artifact', storage, scope.deliveryArtifactId)
	if (!artifact.ok) return artifact

	const ownership = validateDeliveryArtifactOwnership(artifact.value, delivery.id)
	return ownership.ok ? validateDeliveryOpen(delivery) : ownership
}

function validateDeliveryArtifactOwnership(
	artifact: { id: Id; deliveryId: Id },
	deliveryId: Id,
): CoreResult<void, InvariantViolationError> {
	return artifact.deliveryId === deliveryId ? ok() : invariant(`Delivery Artifact ${artifact.id} is outside Delivery ${deliveryId}.`)
}

async function validateSliceRevisionScope(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'slice-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const slice = await getRequired('slice', storage, scope.sliceId)
	return slice.ok ? validateSliceRevisionArtifact(storage, scope, slice.value.id, slice.value.deliveryId) : slice
}

async function validateSliceRevisionArtifact(
	storage: CoreStorage,
	scope: Extract<RevisionScope, { type: 'slice-artifact' }>,
	sliceId: Id,
	deliveryId: Id,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const artifact = await getRequired('slice-artifact', storage, scope.sliceArtifactId)
	if (!artifact.ok) return artifact

	const ownership = validateSliceArtifactOwnership(artifact.value, sliceId)
	return ownership.ok ? validateSliceParentDeliveryOpen(storage, deliveryId) : ownership
}

function validateSliceArtifactOwnership(artifact: { id: Id; sliceId: Id }, sliceId: Id): CoreResult<void, InvariantViolationError> {
	return artifact.sliceId === sliceId ? ok() : invariant(`Slice Artifact ${artifact.id} is outside Slice ${sliceId}.`)
}

async function validateSliceParentDeliveryOpen(
	storage: CoreStorage,
	deliveryId: Id,
): Promise<CoreResult<void, ResourceNotFoundError | StorageOperationFailedError | InvalidCoreServiceOutputError | DeliveryClosedError>> {
	const delivery = await getRequired('delivery', storage, deliveryId)
	return delivery.ok ? validateDeliveryOpen(delivery.value) : delivery
}

function validateDeliveryOpen(delivery: Delivery): CoreResult<void, DeliveryClosedError> {
	return delivery.closed === null
		? ok()
		: { ok: false, error: { type: 'delivery-closed', deliveryId: delivery.id, outcome: delivery.closed.type } }
}

async function writeAcceptedRevision(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revisionId: Id,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const created = await createAcceptedRevisionRecord(storage, context, stamp, revisionId)
	return created.ok ? consumeRevisionGateForRevision(runtime, storage, context, stamp, created.value) : created
}

async function createAcceptedRevisionRecord(
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revisionId: Id,
): Promise<CoreResult<Revision, Exclude<Error, InvalidInputError>>> {
	return createRecordValue('revision', storage, {
		id: revisionId,
		revisionGateId: context.gate.id,
		scope: context.gate.scope,
		instruction: context.output.instruction,
		disposition: context.output.disposition,
		accepted: stamp,
	})
}

async function consumeRevisionGateForRevision(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revision: Revision,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const revisionGate = await updateRecordValue('revision-gate', storage, context.gate.id, {
		closed: { type: 'consumed-by-revision', consumed: stamp, revisionId: revision.id },
	})
	return revisionGate.ok
		? completeRevisionPlanningForAcceptedRevision(runtime, storage, context, stamp, revision, revisionGate.value)
		: revisionGate
}

async function completeRevisionPlanningForAcceptedRevision(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revision: Revision,
	revisionGate: RevisionGate,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const agentRun = await completeAgentRunByPurposeAndAcceptSandboxRelease(
		storage,
		runtime.services.dispatcher,
		{ type: 'revision-planning', revisionGateId: context.gate.id },
		{ at: stamp.at },
	)
	return agentRun.ok
		? appendRevisionProposalAcceptance(runtime, storage, context, stamp, revision, revisionGate, agentRun.value.dispatchMarker)
		: agentRun
}

async function appendRevisionProposalAcceptance(
	runtime: CoreRuntime,
	storage: CoreStorage,
	context: RevisionProposalContext,
	stamp: AuditStamp,
	revision: Revision,
	revisionGate: RevisionGate,
	dispatchMarker: string | null,
): Promise<CoreResult<DispatchedResult, Exclude<Error, InvalidInputError>>> {
	const acceptedEvent = await appendAgentRunEvent(runtime, storage, context.proposal.agentRunId, {
		type: 'proposal-accepted',
		proposalCursor: context.proposal.cursor,
		authorized: stamp,
		materialized: { type: 'revision-output', revisionId: revision.id },
	})
	return acceptedEvent.ok
		? { ok: true, value: { result: { revision, revisionGate, acceptedEvent: acceptedEvent.value }, dispatchMarker } }
		: acceptedEvent
}

function revisionScopeKey(scope: RevisionScope): string {
	switch (scope.type) {
		case 'delivery-artifact':
			return `delivery:${scope.deliveryId}:${scope.deliveryArtifactId}`
		case 'slice-artifact':
			return `slice:${scope.sliceId}:${scope.sliceArtifactId}`
		default:
			throw new Error(`Unexpected revision/review surface scope: ${String(scope satisfies never)}`)
	}
}

function reviewSurfaceScopeKey(scope: ReviewSurfaceScope): string {
	switch (scope.type) {
		case 'delivery':
			return `delivery:${scope.deliveryId}:${scope.deliveryArtifactId}`
		case 'slice':
			return `slice:${scope.sliceId}:${scope.sliceArtifactId}`
		default:
			throw new Error(`Unexpected revision/review surface scope: ${String(scope satisfies never)}`)
	}
}

function ok(): CoreResult<void, never> {
	return { ok: true, value: undefined }
}

function revisionGateClosed(revisionGateId: Id): CoreResult<never, RevisionGateClosedError> {
	return { ok: false, error: { type: 'revision-gate-closed', revisionGateId } }
}

function reviewSurfaceAlreadyMerged(reviewSurfaceId: Id): CoreResult<never, ReviewSurfaceAlreadyMergedError> {
	return { ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId } }
}

function invariant(message: string): CoreResult<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedDelivery, seedSlice, stamp } =
		await import('../utils/test-helpers')

	describe('acceptRevisionOutput command', () => {
		it('validates input before reading storage', async () => {
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptRevisionOutput' },
			})
		})

		it('creates a Delivery-scoped Revision and consumes the Revision Gate from a proposal event', async () => {
			const options = deliveryRevisionFixture()
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event' }, context)

			const expectedRevision = {
				id: 'revision-1',
				revisionGateId: 'revision-gate-1',
				scope: { type: 'delivery-artifact' as const, deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
				instruction: { body: 'Revise artifact.' },
				disposition: { body: 'Address requested changes.' },
				accepted: localStamp(),
			}
			expect(result).toMatchObject({
				ok: true,
				value: {
					revision: expectedRevision,
					revisionGate: { closed: { type: 'consumed-by-revision', revisionId: 'revision-1' } },
					acceptedEvent: { body: { type: 'proposal-accepted', proposalCursor: '01J00000000000000000000000' } },
				},
			})
			expect(options.tx.revisions.records.get('revision-1')).toEqual(expectedRevision)
			expect(options.tx.agentRuns.records.get('agent-run-1')?.completed).toEqual({ at: localStamp().at })
		})

		it('consumes the Revision Gate without overwriting an already completed Agent Run', async () => {
			const options = deliveryRevisionFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('agent-run-1')!.completed = previousCompletion
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event' }, context)

			expect(result).toMatchObject({ ok: true, value: { revisionGate: { closed: { type: 'consumed-by-revision' } } } })
			expect(options.tx.agentRuns.records.get('agent-run-1')?.completed).toEqual(previousCompletion)
		})

		it('creates a Slice-scoped Revision through the Slice parent Delivery', async () => {
			const options = sliceRevisionFixture()
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: 'proposal-event' }, context)

			expect(result).toMatchObject({ ok: true, value: { revision: { scope: { type: 'slice-artifact', sliceId: 'slice-1' } } } })
		})

		it('rejects reviewed, wrong-type, and closed-gate proposals', async () => {
			const reviewed = deliveryRevisionFixture()
			reviewed.tx.agentRunEvents.records.set('review-event', {
				id: 'review-event',
				agentRunId: 'agent-run-1',
				cursor: '01J00000000000000000000001',
				occurred: { at: stamp.at },
				body: { type: 'proposal-rejected', proposalCursor: '01J00000000000000000000000', authorized: stamp, reason: null },
			})
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(reviewed))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'proposal-already-reviewed', proposalEventId: 'proposal-event' },
			})

			const wrongType = deliveryRevisionFixture('proposed-plan-output')
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(wrongType))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'proposal-type-mismatch',
					proposalEventId: 'proposal-event',
					expected: 'proposed-revision-output',
					actual: 'proposed-plan-output',
				},
			})

			const closed = deliveryRevisionFixture()
			closed.tx.revisionGates.records.get('revision-gate-1')!.closed = { type: 'closed-without-revision', closed: localStamp() }
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(closed))({ proposalEventId: 'proposal-event' }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'revision-gate-closed', revisionGateId: 'revision-gate-1' },
			})
		})
	})

	function deliveryRevisionFixture(type: 'proposed-revision-output' | 'proposed-plan-output' = 'proposed-revision-output') {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedDeliveryArtifact(options.tx)
		options.tx.reviewSurfaces.records.set('review-surface-1', deliveryReviewSurface())
		options.tx.revisionGates.records.set('revision-gate-1', {
			id: 'revision-gate-1',
			scope: { type: 'delivery-artifact', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		})
		seedRevisionPlanningAgentRun(options.tx)
		options.tx.agentRunEvents.records.set('proposal-event', proposalEvent(type))
		return options
	}

	function sliceRevisionFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		options.tx.sliceArtifacts.records.set('slice-artifact-1', {
			id: 'slice-artifact-1',
			sliceId: 'slice-1',
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
		options.tx.reviewSurfaces.records.set('review-surface-1', sliceReviewSurface())
		options.tx.revisionGates.records.set('revision-gate-1', {
			id: 'revision-gate-1',
			scope: { type: 'slice-artifact', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
			reviewSurfaceId: 'review-surface-1',
			opened: stamp,
			closed: null,
		})
		seedRevisionPlanningAgentRun(options.tx)
		options.tx.agentRunEvents.records.set('proposal-event', proposalEvent('proposed-revision-output'))
		return options
	}

	function proposalEvent(type: 'proposed-revision-output' | 'proposed-plan-output'): AgentRunEvent {
		return {
			id: 'proposal-event',
			agentRunId: 'agent-run-1',
			cursor: '01J00000000000000000000000',
			occurred: { at: stamp.at },
			body:
				type === 'proposed-revision-output'
					? { type, toolCallStartedCursor: '01J00000000000000000000000', output: revisionOutput() }
					: {
							type,
							toolCallStartedCursor: '01J00000000000000000000000',
							output: {
								proposedDeliveries: {},
								proposedMemoryCreations: { memory: { parentId: null, title: 'Memory', body: '', children: {} } },
								proposedMemoryRevisions: {},
							},
						},
		}
	}

	function revisionOutput(): RevisionOutputProposal {
		return { instruction: { body: 'Revise artifact.' }, disposition: { body: 'Address requested changes.' } }
	}

	function seedRevisionPlanningAgentRun(tx: ReturnType<typeof createTestCoreServices>['tx']) {
		tx.agentRuns.records.set('agent-run-1', {
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
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof createTestCoreServices>['tx']) {
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function deliveryReviewSurface(): ReviewSurface {
		return {
			id: 'review-surface-1',
			scope: { type: 'delivery', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'delivery-branch',
				targetBranch: 'main',
			},
			title: 'Delivery',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}

	function sliceReviewSurface(): ReviewSurface {
		return {
			id: 'review-surface-1',
			scope: { type: 'slice', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'slice-branch',
				targetBranch: 'delivery-branch',
			},
			title: 'Slice',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}
}
