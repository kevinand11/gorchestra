import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run-event'
import { idPipe } from '../domain/commons'
import type { ReviewSurface } from '../domain/review-surface'
import type { Revision, RevisionOutputProposal } from '../domain/revision'
import type { RevisionGate } from '../domain/revision-gate'
import type {
	AgentRunPurposeMismatchError,
	AgentRunTurnActiveError,
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
import type { CoreStorage } from '../services'
import { appendAgentRunEvent, completeAgentRunByIdAndAcceptSandboxRelease, requireAgentRunIdle } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import {
	auditStamp,
	createRecordValue,
	getRequired,
	listRecords,
	nextId,
	updateRecordValue,
	withTransaction,
} from '../utils/command-storage'
import { getPendingProposalForAgentRunPurpose, proposalAcceptedProjectedParts } from '../utils/proposals'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

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
	| AgentRunTurnActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type DispatchedResult = { result: Result; dispatchMarker: string | null }

export function createAcceptRevisionOutputCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('acceptRevisionOutput', acceptRevisionOutputInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		const revisionId = nextId(runtime.values)
		if (!revisionId.ok) return revisionId

		const written = await withTransaction<DispatchedResult, Exclude<Error, InvalidInputError>>(runtime.services, async (storage) => {
			const proposal = await getPendingProposalForAgentRunPurpose(
				storage,
				input.proposalEventId,
				'proposed-revision-output',
				'revision-planning',
			)
			if (!proposal.ok) return proposal

			const gate = await getRequired('revision-gate', storage, proposal.value.agentRun.purpose.revisionGateId)
			if (!gate.ok) return gate
			if (gate.value.closed !== null) {
				return { ok: false, error: { type: 'revision-gate-closed', revisionGateId: gate.value.id } }
			}

			const idle = await requireAgentRunIdle(storage, gate.value.agentRunId)
			if (!idle.ok) return idle

			const revisions = await listRecords('revision', storage, {
				where: (filter, fields) => filter.eq(fields.revisionGateId, gate.value.id),
			})
			if (!revisions.ok) return revisions
			if (revisions.value.length > 0) {
				return {
					ok: false,
					error: { type: 'invariant-violation', message: `Revision Gate ${gate.value.id} already has a Revision.` },
				}
			}

			const scopeValidation = await validateRevisionGateScope(storage, gate.value)
			if (!scopeValidation.ok) return scopeValidation

			const revision = await createRecordValue('revision', storage, {
				id: revisionId.value,
				revisionGateId: gate.value.id,
				scope: gate.value.scope,
				instruction: proposal.value.proposal.body.output.instruction,
				disposition: proposal.value.proposal.body.output.disposition,
				accepted: stamp.value,
			})
			if (!revision.ok) return revision

			const revisionGate = await updateRecordValue('revision-gate', storage, gate.value.id, {
				closed: { type: 'consumed-by-revision', consumed: stamp.value, revisionId: revision.value.id },
			})
			if (!revisionGate.ok) return revisionGate

			const agentRun = await completeAgentRunByIdAndAcceptSandboxRelease(
				storage,
				runtime.services.dispatcher,
				revisionGate.value.agentRunId,
				{ at: stamp.value.at },
			)
			if (!agentRun.ok) return agentRun

			const acceptedEvent = await appendAgentRunEvent(runtime, storage, proposal.value.proposal.agentRunId, {
				type: 'proposal-accepted',
				proposalEventId: proposal.value.proposal.id,
				authorized: stamp.value,
				materialized: { type: 'revision-output', revisionId: revision.value.id },
				projectedParts: proposalAcceptedProjectedParts(proposal.value.proposal.id),
			})
			return acceptedEvent.ok
				? {
						ok: true,
						value: {
							result: { revision: revision.value, revisionGate: revisionGate.value, acceptedEvent: acceptedEvent.value },
							dispatchMarker: agentRun.value.dispatchMarker,
						},
					}
				: acceptedEvent
		})
		if (!written.ok) return written
		if (written.value.dispatchMarker !== null) runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.result }
	})
}

async function validateRevisionGateScope(
	storage: CoreStorage,
	gate: RevisionGate,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const reviewSurface = await getRequired('review-surface', storage, gate.reviewSurfaceId)
	if (!reviewSurface.ok) return reviewSurface

	const gateScopeKey =
		gate.scope.type === 'delivery-artifact'
			? `delivery:${gate.scope.deliveryId}:${gate.scope.deliveryArtifactId}`
			: `slice:${gate.scope.sliceId}:${gate.scope.sliceArtifactId}`
	const reviewSurfaceScopeKey =
		reviewSurface.value.scope.type === 'delivery'
			? `delivery:${reviewSurface.value.scope.deliveryId}:${reviewSurface.value.scope.deliveryArtifactId}`
			: `slice:${reviewSurface.value.scope.sliceId}:${reviewSurface.value.scope.sliceArtifactId}`
	if (gateScopeKey !== reviewSurfaceScopeKey) {
		return {
			ok: false,
			error: {
				type: 'invariant-violation',
				message: `Revision Gate ${gate.id} scope does not match Review Surface ${reviewSurface.value.id}.`,
			},
		}
	}
	if (reviewSurface.value.closed?.type === 'merged') {
		return { ok: false, error: { type: 'review-surface-already-merged', reviewSurfaceId: reviewSurface.value.id } }
	}

	return gate.scope.type === 'delivery-artifact'
		? validateDeliveryRevisionGateScope(storage, gate.scope)
		: validateSliceRevisionGateScope(storage, gate.scope)
}

async function validateDeliveryRevisionGateScope(
	storage: CoreStorage,
	scope: Extract<RevisionGate['scope'], { type: 'delivery-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const delivery = await getRequired('delivery', storage, scope.deliveryId)
	if (!delivery.ok) return delivery

	const artifact = await getRequired('delivery-artifact', storage, scope.deliveryArtifactId)
	if (!artifact.ok) return artifact
	if (artifact.value.deliveryId !== delivery.value.id) {
		return {
			ok: false,
			error: {
				type: 'invariant-violation',
				message: `Delivery Artifact ${artifact.value.id} is outside Delivery ${delivery.value.id}.`,
			},
		}
	}
	return delivery.value.closed === null
		? { ok: true, value: undefined }
		: { ok: false, error: { type: 'delivery-closed', deliveryId: delivery.value.id, outcome: delivery.value.closed.type } }
}

async function validateSliceRevisionGateScope(
	storage: CoreStorage,
	scope: Extract<RevisionGate['scope'], { type: 'slice-artifact' }>,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const slice = await getRequired('slice', storage, scope.sliceId)
	if (!slice.ok) return slice

	const artifact = await getRequired('slice-artifact', storage, scope.sliceArtifactId)
	if (!artifact.ok) return artifact
	if (artifact.value.sliceId !== slice.value.id) {
		return {
			ok: false,
			error: { type: 'invariant-violation', message: `Slice Artifact ${artifact.value.id} is outside Slice ${slice.value.id}.` },
		}
	}

	const delivery = await getRequired('delivery', storage, slice.value.deliveryId)
	if (!delivery.ok) return delivery
	return delivery.value.closed === null
		? { ok: true, value: undefined }
		: { ok: false, error: { type: 'delivery-closed', deliveryId: delivery.value.id, outcome: delivery.value.closed.type } }
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

		it('rejects acceptance when the Revision Planning Agent Run has an unmatched active turn', async () => {
			const options = deliveryRevisionFixture()
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
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime(options))

			const result = await command({ proposalEventId }, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'agent-run-turn-active', agentRunId: '01k00000000000000000000002', turnStartedEventId: 'turn-started' },
			})
			expect(options.tx.revisions.records.size).toBe(0)
			expect(options.tx.revisionGates.records.get('01k00000000000000000000039')?.closed).toBeNull()
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
			agentRunId: '01k00000000000000000000002',
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
			agentRunId: '01k00000000000000000000002',
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
