import type { Action } from '../../domain/action'
import type { DeliveryArtifact } from '../../domain/artifact'
import { deliveryPipe, type Delivery, type DeliveryIntegration, type DeliveryWorkState } from '../../domain/delivery'
import { type ReviewSurface, type ReviewSurfaceClosed } from '../../domain/review-surface'
import { slicePipe, type Slice } from '../../domain/slice'
import type { CoreStorageTransaction } from '../../services'
import { getRequired } from '../storage'
import type { Result } from '../types'
import { loadWorkStateFacts } from './facts'
import {
	blockedDependencyIds,
	compareActions,
	currentScopedReviewSurface,
	firstState,
	invariant,
	latestAction,
	latestKnownAction,
	ok,
	singleDeliveryArtifact,
	stateOrElse,
} from './shared'
import { deriveSliceWorkStateFromFacts } from './slice'
import type { DeliveryDependencyLink, WorkStateDerivationError, WorkStateFacts, WorkStateResult } from './types'

interface DeliveryValidationContext {
	latestValidation: Action | null
	latestPassedValidation: Action | null
}

export async function deriveDeliveryWorkState(
	tx: CoreStorageTransaction,
	deliveryId: Delivery['id'],
): Promise<Result<DeliveryWorkState, WorkStateDerivationError>> {
	const deliveryResult = await getRequired('delivery', tx.deliveries, deliveryId, deliveryPipe)
	if (!deliveryResult.ok) return deliveryResult

	const factsResult = await loadWorkStateFacts(tx)
	if (!factsResult.ok) return factsResult

	return deriveDeliveryWorkStateFromFacts(tx, deliveryResult.value, factsResult.value)
}

async function deriveDeliveryWorkStateFromFacts(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: WorkStateFacts,
): Promise<WorkStateResult<DeliveryWorkState>> {
	const deliveryActions = facts.actions.filter((action) => action.deliveryId === delivery.id).sort(compareActions)
	const earlyState = await firstState([
		() => immediateDeliveryLifecycleState(deliveryActions),
		() => deliveryDependencyState(tx, delivery, facts),
		() => deliveryPreflightState(deliveryActions),
	])

	return stateOrElse(earlyState, () => deriveDeliveryStateAfterEarlyGates(tx, delivery, deliveryActions, facts))
}

async function deriveDeliveryStateAfterEarlyGates(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	deliveryActions: Action[],
	facts: WorkStateFacts,
): Promise<WorkStateResult<DeliveryWorkState>> {
	const artifactDecision = deliveryArtifactDecision(delivery, facts)
	if (!artifactDecision.ok) return artifactDecision
	if (artifactDecision.value.type === 'state') return ok(artifactDecision.value.state)

	return deriveDeliveryStateWithArtifact(tx, delivery, deliveryActions, artifactDecision.value.artifact, facts)
}

function deliveryArtifactDecision(
	delivery: Delivery,
	facts: WorkStateFacts,
): WorkStateResult<{ type: 'artifact'; artifact: DeliveryArtifact } | { type: 'state'; state: DeliveryWorkState }> {
	const artifact = singleDeliveryArtifact(delivery.id, facts.deliveryArtifacts)
	if (!artifact.ok) return artifact

	return artifact.value === null
		? ok({ type: 'state', state: { type: 'needs-artifact-creation' } })
		: ok({ type: 'artifact', artifact: artifact.value })
}

async function deriveDeliveryStateWithArtifact(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	facts: WorkStateFacts,
): Promise<WorkStateResult<DeliveryWorkState>> {
	const latestSliceCompletion = await latestSliceCompletionForDelivery(tx, delivery, facts)
	if (!latestSliceCompletion.ok) return latestSliceCompletion

	return latestSliceCompletion.value === null
		? ok({ type: 'slices-incomplete' })
		: deriveCompletedSlicesDeliveryState(delivery, deliveryActions, deliveryArtifact, latestSliceCompletion.value, facts)
}

function immediateDeliveryLifecycleState(deliveryActions: Action[]): WorkStateResult<DeliveryWorkState | null> {
	const closeAction = latestAction(
		deliveryActions.filter((action) => action.result.type === 'ship-delivery' || action.result.type === 'abandon-delivery'),
	)
	if (closeAction !== null) return ok(deliveryClosedState(closeAction))

	return deliveryActions.some((action) => action.result.type === 'queue-delivery') ? ok(null) : ok({ type: 'unqueued' })
}

function deliveryClosedState(action: Action): DeliveryWorkState {
	return {
		type: 'closed',
		outcome: action.result.type === 'ship-delivery' ? 'shipped' : 'abandoned',
		actionId: action.id,
	}
}

async function deliveryDependencyState(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: WorkStateFacts,
): Promise<WorkStateResult<DeliveryWorkState | null>> {
	const blockedIds = await blockedDeliveryIds(tx, delivery, facts)
	if (!blockedIds.ok) return blockedIds

	return blockedIds.value.length === 0 ? ok(null) : ok({ type: 'dependency-blocked', blockedBy: blockedIds.value })
}

function deliveryPreflightState(deliveryActions: Action[]): WorkStateResult<DeliveryWorkState | null> {
	const latestPreflight = latestAction(deliveryActions.filter((action) => action.result.type === 'validate-preflight'))
	if (latestPreflight?.result.type !== 'validate-preflight') return ok(null)

	return latestPreflight.result.evidence.passed ? ok(null) : ok({ type: 'preflight-failed', actionId: latestPreflight.id })
}

async function latestSliceCompletionForDelivery(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: WorkStateFacts,
): Promise<WorkStateResult<Action | null>> {
	if (delivery.sliceIds.length === 0) return invariant('Delivery must contain at least one Slice.')

	const actionIds = await sliceCompletionActionIdsForDelivery(tx, delivery, facts)
	if (!actionIds.ok) return actionIds

	return actionIds.value === null ? ok(null) : latestKnownAction(actionIds.value, facts.actions)
}

async function sliceCompletionActionIdsForDelivery(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: WorkStateFacts,
): Promise<WorkStateResult<Slice['id'][] | null>> {
	const actionIds: Slice['id'][] = []
	for (const sliceId of delivery.sliceIds) {
		const completion = await sliceCompletionActionId(tx, delivery, sliceId, facts)
		if (!completion.ok) return completion
		if (completion.value === null) return ok(null)
		actionIds.push(completion.value)
	}

	return ok(actionIds)
}

async function sliceCompletionActionId(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	sliceId: Slice['id'],
	facts: WorkStateFacts,
): Promise<WorkStateResult<Slice['id'] | null>> {
	const sliceResult = await deliverySlice(tx, delivery, sliceId)
	if (!sliceResult.ok) return sliceResult

	const sliceState = await deriveSliceWorkStateFromFacts(tx, sliceResult.value, facts)
	if (!sliceState.ok) return sliceState

	return sliceState.value.type === 'complete' ? ok(sliceState.value.actionId) : ok(null)
}

async function deliverySlice(tx: CoreStorageTransaction, delivery: Delivery, sliceId: Slice['id']): Promise<WorkStateResult<Slice>> {
	const sliceResult = await getRequired('slice', tx.slices, sliceId, slicePipe)
	if (!sliceResult.ok) return sliceResult

	return sliceResult.value.deliveryId === delivery.id
		? ok(sliceResult.value)
		: invariant(`Slice ${sliceId} does not belong to Delivery ${delivery.id}.`)
}

function deriveCompletedSlicesDeliveryState(
	delivery: Delivery,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	latestSliceCompletion: Action,
	facts: WorkStateFacts,
): WorkStateResult<DeliveryWorkState> {
	const validation = deliveryValidationContext(deliveryActions, latestSliceCompletion)
	const validationState = deliveryValidationState(deliveryActions, validation)
	if (validationState !== null) return ok(validationState)
	if (validation.latestPassedValidation === null) return ok({ type: 'needs-artifact-validation' })

	return deliveryReadyReviewState(delivery, deliveryActions, deliveryArtifact, validation.latestPassedValidation, facts)
}

function deliveryValidationContext(deliveryActions: Action[], latestSliceCompletion: Action): DeliveryValidationContext {
	const validationActions = deliveryActions.filter(
		(action) => action.result.type === 'validate-delivery-artifact' && compareActions(action, latestSliceCompletion) > 0,
	)

	return {
		latestValidation: latestAction(validationActions),
		latestPassedValidation: latestAction(
			validationActions.filter((action) => action.result.type === 'validate-delivery-artifact' && action.result.evidence.passed),
		),
	}
}

function deliveryValidationState(deliveryActions: Action[], validation: DeliveryValidationContext): DeliveryWorkState | null {
	const operationFailureState = deliveryOperationFailureState(deliveryActions, validation.latestPassedValidation)
	return operationFailureState ?? failedDeliveryValidationState(validation.latestValidation)
}

function deliveryOperationFailureState(deliveryActions: Action[], latestPassedValidation: Action | null): DeliveryWorkState | null {
	const failure = latestPassedValidation === null ? null : latestDeliveryFailureAfter(deliveryActions, latestPassedValidation)
	return failure === null ? null : { type: 'delivery-operation-failed', actionId: failure.id }
}

function failedDeliveryValidationState(latestValidation: Action | null): DeliveryWorkState | null {
	if (latestValidation?.result.type !== 'validate-delivery-artifact') return null

	return latestValidation.result.evidence.passed ? null : { type: 'delivery-validation-failed', actionId: latestValidation.id }
}

function latestDeliveryFailureAfter(deliveryActions: Action[], action: Action): Action | null {
	return latestAction(
		deliveryActions.filter(
			(candidate) => candidate.result.type === 'record-delivery-external-operation-failure' && compareActions(candidate, action) > 0,
		),
	)
}

function deliveryReadyReviewState(
	delivery: Delivery,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	latestPassedDeliveryValidation: Action,
	facts: WorkStateFacts,
): WorkStateResult<DeliveryWorkState> {
	const reviewSurface = currentDeliveryReviewSurface(delivery, deliveryArtifact.id, facts)
	if (!reviewSurface.ok) return reviewSurface

	const reviewState = deliveryReviewState(reviewSurface.value)
	if (reviewState !== null) return ok(reviewState)

	return deliveryReviewWaitingState(deliveryActions, latestPassedDeliveryValidation, reviewSurface.value)
}

function deliveryReviewWaitingState(
	deliveryActions: Action[],
	latestPassedDeliveryValidation: Action,
	reviewSurface: ReviewSurface | null,
): WorkStateResult<DeliveryWorkState> {
	const observedIntegration = latestObservedDeliveryIntegration(deliveryActions, latestPassedDeliveryValidation)
	if (observedIntegration !== null) return ok(deliveryReadyByObservationState(observedIntegration))

	return reviewSurface === null
		? ok({ type: 'needs-review-surface' })
		: ok({ type: 'awaiting-review', reviewSurfaceId: reviewSurface.id })
}

function currentDeliveryReviewSurface(
	delivery: Delivery,
	deliveryArtifactId: DeliveryArtifact['id'],
	facts: WorkStateFacts,
): WorkStateResult<ReviewSurface | null> {
	return currentScopedReviewSurface(
		facts.reviewSurfaces.filter(
			(reviewSurface) =>
				reviewSurface.scope.type === 'delivery' &&
				reviewSurface.scope.deliveryId === delivery.id &&
				reviewSurface.scope.deliveryArtifactId === deliveryArtifactId,
		),
	)
}

function deliveryReviewState(reviewSurface: ReviewSurface | null): DeliveryWorkState | null {
	return reviewSurface?.closed === null || reviewSurface === null
		? null
		: closedDeliveryReviewState(reviewSurface.id, reviewSurface.closed)
}

function closedDeliveryReviewState(reviewSurfaceId: ReviewSurface['id'], closed: ReviewSurfaceClosed): DeliveryWorkState | null {
	if (closed.type === 'closed-without-merge') return { type: 'delivery-review-failed', reviewSurfaceId }
	if (closed.type === 'merged') return { type: 'ready-to-ship', integration: { type: 'review-surface-merged', reviewSurfaceId } }

	return null
}

function latestObservedDeliveryIntegration(deliveryActions: Action[], latestPassedDeliveryValidation: Action): Action | null {
	return latestAction(
		deliveryActions.filter(
			(action) =>
				action.result.type === 'observe-delivery-artifact-integration' &&
				action.result.evidence.passed &&
				compareActions(action, latestPassedDeliveryValidation) > 0,
		),
	)
}

function deliveryReadyByObservationState(action: Action): DeliveryWorkState {
	return {
		type: 'ready-to-ship',
		integration: { type: 'observed-artifact-integration', actionId: action.id } satisfies DeliveryIntegration,
	}
}

async function blockedDeliveryIds(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: WorkStateFacts,
): Promise<WorkStateResult<Delivery['id'][]>> {
	return blockedDependencyIds(
		facts.links,
		(candidate): candidate is DeliveryDependencyLink => isDeliveryDependencyLink(candidate, delivery.id),
		(link) => unclosedDeliveryDependency(tx, delivery, link, facts.actions),
	)
}

function isDeliveryDependencyLink(link: WorkStateFacts['links'][number], deliveryId: Delivery['id']): link is DeliveryDependencyLink {
	return link.type === 'depends-on' && link.from.type === 'delivery' && link.from.id === deliveryId && link.to.type === 'delivery'
}

async function unclosedDeliveryDependency(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	link: DeliveryDependencyLink,
	actions: Action[],
): Promise<WorkStateResult<Delivery | null>> {
	const prerequisite = await getRequired('delivery', tx.deliveries, link.to.id, deliveryPipe)
	if (!prerequisite.ok) return prerequisite
	if (prerequisite.value.projectId !== delivery.projectId) {
		return invariant(`Delivery dependency ${prerequisite.value.id} is outside Project ${delivery.projectId}.`)
	}

	return isDeliveryClosed(prerequisite.value.id, actions) ? ok(null) : ok(prerequisite.value)
}

function isDeliveryClosed(deliveryId: Delivery['id'], actions: Action[]): boolean {
	return actions.some(
		(action) =>
			action.deliveryId === deliveryId && (action.result.type === 'ship-delivery' || action.result.type === 'abandon-delivery'),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions, externalOperationEvidence, seedDelivery, seedSlice, stamp, validationEvidence } =
		await import('../../commands/test-utils')
	const passedValidation = validationEvidence('delivery-branch-validation', true, 'Valid.')
	const failedValidation = validationEvidence('delivery-branch-validation', false, 'Invalid.')
	const externalFailure = externalOperationEvidence('push-branch', false, 'Failed.')
	const externalPassed = externalOperationEvidence('observe-artifact-integration', true, 'Integrated.')
	const sliceValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const slicePromotion = externalOperationEvidence('merge-review-surface', true, 'Merged.')

	describe('deriveDeliveryWorkState', () => {
		it('derives closed from the latest close Action', async () => {
			const { tx } = deliveryFixture()
			seedAction(tx, {
				id: 'ship-delivery',
				result: { type: 'ship-delivery', integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' } },
			})

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'closed', outcome: 'shipped', actionId: 'ship-delivery' },
			})
		})

		it('derives unqueued before a queue-delivery Action exists', async () => {
			const { tx } = deliveryFixture()

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'unqueued' } })
		})

		it('derives dependency-blocked from an unclosed same-Project prerequisite Delivery', async () => {
			const { tx } = deliveryFixture({ queued: true })
			seedDelivery(tx, 'delivery-prerequisite')
			tx.links.records.set('delivery-dependency', {
				id: 'delivery-dependency',
				type: 'depends-on',
				from: { type: 'delivery', id: 'delivery-1' },
				to: { type: 'delivery', id: 'delivery-prerequisite' },
				created: stamp,
				archivePeriods: [],
			})

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'dependency-blocked', blockedBy: ['delivery-prerequisite'] },
			})
		})

		it('derives preflight-failed from the latest failed Delivery preflight validation', async () => {
			const { tx } = deliveryFixture({ queued: true })
			seedAction(tx, { id: 'preflight-failed', result: { type: 'validate-preflight', evidence: failedValidation } })

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'preflight-failed', actionId: 'preflight-failed' },
			})
		})

		it('derives needs-artifact-creation after queueing before a Delivery Artifact exists', async () => {
			const { tx } = deliveryFixture({ queued: true })

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives slices-incomplete when at least one Slice is not complete', async () => {
			const { tx } = deliveryFixture({ queued: true, withDeliveryArtifact: true, withSlice: true })

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'slices-incomplete' } })
		})

		it('derives delivery-operation-failed from a Delivery-scoped external failure after passed validation', async () => {
			const { tx } = completedDeliveryFixture()
			seedDeliveryValidation(tx, 'delivery-validation', true)
			seedAction(tx, {
				id: 'delivery-operation-failed',
				at: '2026-06-10T12:04:00.000Z',
				result: { type: 'record-delivery-external-operation-failure', evidence: externalFailure },
			})

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-operation-failed', actionId: 'delivery-operation-failed' },
			})
		})

		it('derives delivery-validation-failed from the latest failed Delivery Artifact validation', async () => {
			const { tx } = completedDeliveryFixture()
			seedDeliveryValidation(tx, 'delivery-validation-failed', false)

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-validation-failed', actionId: 'delivery-validation-failed' },
			})
		})

		it('derives delivery-review-failed when the current Delivery Review Surface closed without merge', async () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, { id: 'delivery-review', closed: { type: 'closed-without-merge', closed: stamp } })

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-review-failed', reviewSurfaceId: 'delivery-review' },
			})
		})

		it('derives needs-artifact-validation after all Slices complete before Delivery Artifact validation', async () => {
			const { tx } = completedDeliveryFixture()

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-artifact-validation' } })
		})

		it('derives needs-review-surface after passed Delivery Artifact validation before review exists', async () => {
			const { tx } = validatedDeliveryFixture()

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-review-surface' } })
		})

		it('derives awaiting-review while the current Delivery Review Surface is open', async () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, { id: 'delivery-review', closed: null })

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'awaiting-review', reviewSurfaceId: 'delivery-review' },
			})
		})

		it('derives ready-to-ship when the current Delivery Review Surface is merged', async () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, {
				id: 'delivery-review',
				closed: {
					type: 'merged',
					merged: stamp,
					config: { type: 'source-control', repositoryId: 'repository-1', sourceBranch: 'delivery', targetBranch: 'main' },
				},
			})

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'ready-to-ship', integration: { type: 'review-surface-merged', reviewSurfaceId: 'delivery-review' } },
			})
		})

		it('derives ready-to-ship when Delivery Artifact integration is observed after validation', async () => {
			const { tx } = validatedDeliveryFixture()
			seedAction(tx, {
				id: 'observe-integration',
				at: '2026-06-10T12:04:00.000Z',
				result: { type: 'observe-delivery-artifact-integration', evidence: externalPassed },
			})

			expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'ready-to-ship', integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' } },
			})
		})
	})

	function deliveryFixture(options: { queued?: boolean; withDeliveryArtifact?: boolean; withSlice?: boolean } = {}) {
		const core = createTestOpenCoreOptions()
		seedDelivery(core.tx, 'delivery-1')
		if (options.withSlice === true) seedSlice(core.tx, 'slice-1', 'delivery-1')
		if (options.queued === true) seedAction(core.tx, { id: 'queue-delivery', result: { type: 'queue-delivery' } })
		if (options.withDeliveryArtifact === true) seedDeliveryArtifact(core.tx)

		return core
	}

	function completedDeliveryFixture() {
		const core = deliveryFixture({ queued: true, withDeliveryArtifact: true, withSlice: true })
		seedAction(core.tx, {
			id: 'promote-slice',
			at: '2026-06-10T12:01:00.000Z',
			result: { type: 'promote-slice-artifact', sliceId: 'slice-1', evidence: slicePromotion },
		})
		seedAction(core.tx, {
			id: 'slice-complete',
			at: '2026-06-10T12:02:00.000Z',
			result: { type: 'validate-slice-delivery-artifact', sliceId: 'slice-1', evidence: sliceValidation },
		})

		return core
	}

	function validatedDeliveryFixture() {
		const core = completedDeliveryFixture()
		seedDeliveryValidation(core.tx, 'delivery-validation', true)

		return core
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof deliveryFixture>['tx']) {
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery' },
			created: stamp,
		})
	}

	function seedDeliveryValidation(tx: ReturnType<typeof deliveryFixture>['tx'], id: string, passed: boolean) {
		seedAction(tx, {
			id,
			at: '2026-06-10T12:03:00.000Z',
			result: { type: 'validate-delivery-artifact', evidence: passed ? passedValidation : failedValidation },
		})
	}

	function seedDeliveryReviewSurface(
		tx: ReturnType<typeof deliveryFixture>['tx'],
		reviewSurface: { id: string; closed: ReviewSurfaceClosed | null },
	) {
		tx.reviewSurfaces.records.set(reviewSurface.id, {
			id: reviewSurface.id,
			scope: { type: 'delivery', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
			config: {
				provider: 'github',
				pullRequestNumber: 1,
				repositoryId: 'repository-1',
				sourceBranch: 'delivery',
				targetBranch: 'main',
			},
			title: 'Delivery Review',
			body: 'Review body',
			closed: reviewSurface.closed,
			created: stamp,
		})
	}

	function seedAction(tx: ReturnType<typeof deliveryFixture>['tx'], action: { id: string; at?: string; result: Action['result'] }) {
		tx.actions.records.set(action.id, {
			id: action.id,
			deliveryId: 'delivery-1',
			performed: { at: action.at ?? '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: action.result,
		})
	}

	it('validates listed Link records before deriving dependencies', async () => {
		const { tx } = deliveryFixture({ queued: true })
		tx.links.records.set('broken-link', { id: 'different-id', type: 'depends-on' } as never)

		expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toMatchObject({
			ok: false,
			error: {
				type: 'invalid-core-service-output',
				service: 'storage',
				operation: 'list:link',
			},
		})
	})

	it('reports missing query target Delivery as not-found', async () => {
		const { tx } = deliveryFixture()

		expect(await deriveDeliveryWorkState(tx, 'missing-delivery')).toEqual({
			ok: false,
			error: { type: 'not-found', resource: 'delivery', id: 'missing-delivery' },
		})
	})

	it('reports missing referenced Slice as an invariant violation through derived Delivery state', async () => {
		const { tx } = deliveryFixture({ queued: true, withDeliveryArtifact: true })
		const delivery = tx.deliveries.records.get('delivery-1')
		tx.deliveries.records.set('delivery-1', { ...delivery!, sliceIds: ['missing-slice'] })

		expect(await deriveDeliveryWorkState(tx, 'delivery-1')).toEqual({
			ok: false,
			error: { type: 'not-found', resource: 'slice', id: 'missing-slice' },
		})
	})
}
