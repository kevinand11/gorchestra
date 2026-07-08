import { v, type PipeOutput } from 'valleyed'

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
import type { CommandContext } from './types'
import { appendAgentRunEvent, completeAgentRunByPurposeAndAcceptSandboxRelease } from '../utils/agent-runs'
import { getPendingProposalForAgentRunPurpose, proposalAcceptedProjectedParts } from '../utils/proposals'
import type { Result as CoreResult } from '../utils/types'
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

	const revisionId = nextId(runtime.values)
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
		proposalEventId: context.proposal.id,
		authorized: stamp,
		materialized: { type: 'revision-output', revisionId: revision.id },
		projectedParts: proposalAcceptedProjectedParts(context.proposal.id),
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
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultAgentRunSandboxConfig,
		localStamp,
		seedDelivery,
		seedSlice,
		stamp,
	} = await import('../utils/test-helpers')
	const proposalEventId = '01k00000000000000000000003'
	const reviewEventId = '01k00000000000000000000004'

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

			const result = await command({ proposalEventId: proposalEventId }, context)

			const expectedRevision = {
				id: '01k00000000000000000010001',
				revisionGateId: '01k00000000000000000000039',
				scope: {
					type: 'delivery-artifact' as const,
					deliveryId: '01k00000000000000000000008',
					deliveryArtifactId: '01k00000000000000000000010',
				},
				instruction: { body: 'Revise artifact.' },
				disposition: { body: 'Address requested changes.' },
				accepted: localStamp(),
			}
			expect(result).toMatchObject({
				ok: true,
				value: {
					revision: expectedRevision,
					revisionGate: { closed: { type: 'consumed-by-revision', revisionId: '01k00000000000000000010001' } },
					acceptedEvent: { body: { type: 'proposal-accepted', proposalEventId } },
				},
			})
			expect(options.tx.revisions.records.get('01k00000000000000000010001')).toEqual(expectedRevision)
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.completed).toEqual({ at: localStamp().at })
		})

		it('consumes the Revision Gate without overwriting an already completed Agent Run', async () => {
			const options = deliveryRevisionFixture()
			const previousCompletion = { at: '2026-06-10T11:30:00.000Z' }
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.completed = previousCompletion
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: proposalEventId }, context)

			expect(result).toMatchObject({ ok: true, value: { revisionGate: { closed: { type: 'consumed-by-revision' } } } })
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.completed).toEqual(previousCompletion)
		})

		it('creates a Slice-scoped Revision through the Slice parent Delivery', async () => {
			const options = sliceRevisionFixture()
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId: proposalEventId }, context)

			expect(result).toMatchObject({
				ok: true,
				value: { revision: { scope: { type: 'slice-artifact', sliceId: '01k00000000000000000000042' } } },
			})
		})

		it('rejects reviewed, wrong-type, and closed-gate proposals', async () => {
			const reviewed = deliveryRevisionFixture()
			reviewed.tx.agentRunEvents.records.set(reviewEventId, {
				id: reviewEventId,
				agentRunId: '01k00000000000000000000002',
				occurred: { at: stamp.at },
				body: {
					type: 'proposal-rejected',
					proposalEventId,
					authorized: stamp,
					reason: null,
					projectedParts: [{ type: 'text', text: 'Proposal reviewed.', metadata: null }],
				},
			})
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(reviewed))({ proposalEventId: proposalEventId }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'proposal-already-reviewed', proposalEventId: proposalEventId },
			})

			const wrongType = deliveryRevisionFixture('proposed-plan-output')
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(wrongType))({ proposalEventId: proposalEventId }, context),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'proposal-type-mismatch',
					proposalEventId: proposalEventId,
					expected: 'proposed-revision-output',
					actual: 'proposed-plan-output',
				},
			})

			const closed = deliveryRevisionFixture()
			closed.tx.revisionGates.records.get('01k00000000000000000000039')!.closed = {
				type: 'closed-without-revision',
				closed: localStamp(),
			}
			await expect(
				createAcceptRevisionOutputCommand(createTestCoreRuntime(closed))({ proposalEventId: proposalEventId }, context),
			).resolves.toEqual({
				ok: false,
				error: { type: 'revision-gate-closed', revisionGateId: '01k00000000000000000000039' },
			})
		})
	})

	function deliveryRevisionFixture(type: 'proposed-revision-output' | 'proposed-plan-output' = 'proposed-revision-output') {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedDeliveryArtifact(options.tx)
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', deliveryReviewSurface())
		options.tx.revisionGates.records.set('01k00000000000000000000039', {
			id: '01k00000000000000000000039',
			scope: {
				type: 'delivery-artifact',
				deliveryId: '01k00000000000000000000008',
				deliveryArtifactId: '01k00000000000000000000010',
			},
			reviewSurfaceId: '01k00000000000000000000037',
			opened: stamp,
			closed: null,
		})
		seedRevisionPlanningAgentRun(options.tx)
		options.tx.agentRunEvents.records.set(proposalEventId, proposalEvent(type))
		return options
	}

	function sliceRevisionFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		options.tx.sliceArtifacts.records.set('01k00000000000000000000045', {
			id: '01k00000000000000000000045',
			sliceId: '01k00000000000000000000042',
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
		options.tx.reviewSurfaces.records.set('01k00000000000000000000037', sliceReviewSurface())
		options.tx.revisionGates.records.set('01k00000000000000000000039', {
			id: '01k00000000000000000000039',
			scope: { type: 'slice-artifact', sliceId: '01k00000000000000000000042', sliceArtifactId: '01k00000000000000000000045' },
			reviewSurfaceId: '01k00000000000000000000037',
			opened: stamp,
			closed: null,
		})
		seedRevisionPlanningAgentRun(options.tx)
		options.tx.agentRunEvents.records.set(proposalEventId, proposalEvent('proposed-revision-output'))
		return options
	}

	function proposalEvent(type: 'proposed-revision-output' | 'proposed-plan-output'): AgentRunEvent {
		return {
			id: proposalEventId,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: stamp.at },
			body:
				type === 'proposed-revision-output'
					? {
							type,
							assistantMessageEventId: '01j00000000000000000000000',
							toolCallId: 'call-1',
							output: revisionOutput(),
						}
					: {
							type,
							assistantMessageEventId: '01j00000000000000000000000',
							toolCallId: 'call-1',
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
		tx.agentRuns.records.set('01k00000000000000000000002', {
			id: '01k00000000000000000000002',
			agent: { type: 'model' },
			purpose: { type: 'revision-planning', revisionGateId: '01k00000000000000000000039' },
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
				sandboxConfig: defaultAgentRunSandboxConfig(),
			},
			toolSet: [],
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: null,
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof createTestCoreServices>['tx']) {
		tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
			id: '01k00000000000000000000010',
			deliveryId: '01k00000000000000000000008',
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: { at: '2026-06-10T12:00:00.000Z' },
		})
	}

	function deliveryReviewSurface(): ReviewSurface {
		return {
			id: '01k00000000000000000000037',
			scope: { type: 'delivery', deliveryId: '01k00000000000000000000008', deliveryArtifactId: '01k00000000000000000000010' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: '01k00000000000000000000034',
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
			id: '01k00000000000000000000037',
			scope: { type: 'slice', sliceId: '01k00000000000000000000042', sliceArtifactId: '01k00000000000000000000045' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: '01k00000000000000000000034',
				sourceBranch: 'slice-branch',
				targetBranch: 'delivery-branch',
			},
			title: 'Slice',
			closed: null,
			created: { at: '2026-06-10T12:00:00.000Z' },
		}
	}
}
