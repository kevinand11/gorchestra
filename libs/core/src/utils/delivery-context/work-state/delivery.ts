import { compareActions, latestAction, latestKnownAction } from './actions'
import { compareAcceptedThenId } from './dependencies'
import { firstSyncState, ok, stateOrElseSync } from './result'
import { currentScopedReviewSurface } from './review-surfaces'
import { getSliceState } from './slice'
import type { WorkStateDerivationError, WorkStateResult } from './types'
import type { Action } from '../../../domain/action'
import type { DeliveryArtifact } from '../../../domain/artifact'
import type { Delivery, DeliveryIntegration, DeliveryWorkState } from '../../../domain/delivery'
import { type ReviewSurface, type ReviewSurfaceClosed } from '../../../domain/review-surface'
import type { Slice } from '../../../domain/slice'
import type { Result } from '../../types'
import type { DeliveryContext } from '../types'

interface DeliveryValidationContext {
	latestValidation: Action | null
	latestPassedValidation: Action | null
}

export function getDeliveryState(context: DeliveryContext): Result<DeliveryWorkState, WorkStateDerivationError> {
	const deliveryActions = deliveryActionsFor(context)
	const earlyState = firstSyncState([
		() => immediateDeliveryLifecycleState(context),
		() => deliveryDependencyState(context),
		() => deliveryPreflightState(deliveryActions),
	])

	return stateOrElseSync(earlyState, () => deriveDeliveryStateAfterEarlyGates(context, deliveryActions))
}

function deliveryActionsFor(context: DeliveryContext): Action[] {
	return context.actions.filter((action) => action.deliveryId === context.delivery.id)
}

function deriveDeliveryStateAfterEarlyGates(context: DeliveryContext, deliveryActions: Action[]): WorkStateResult<DeliveryWorkState> {
	const artifactDecision = deliveryArtifactDecision(context)
	if (!artifactDecision.ok) return artifactDecision
	if (artifactDecision.value.type === 'state') return ok(artifactDecision.value.state)

	return deriveDeliveryStateWithArtifact(context, deliveryActions, artifactDecision.value.artifact)
}

function deliveryArtifactDecision(
	context: DeliveryContext,
): WorkStateResult<{ type: 'artifact'; artifact: DeliveryArtifact } | { type: 'state'; state: DeliveryWorkState }> {
	return context.deliveryArtifact === null
		? ok({ type: 'state', state: { type: 'needs-artifact-creation' } })
		: ok({ type: 'artifact', artifact: context.deliveryArtifact })
}

function deriveDeliveryStateWithArtifact(
	context: DeliveryContext,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
): WorkStateResult<DeliveryWorkState> {
	const latestSliceCompletion = latestSliceCompletionForDelivery(context)
	if (!latestSliceCompletion.ok) return latestSliceCompletion

	return latestSliceCompletion.value === null
		? ok({ type: 'slices-incomplete' })
		: deriveCompletedSlicesDeliveryState(context, deliveryActions, deliveryArtifact, latestSliceCompletion.value)
}

function immediateDeliveryLifecycleState(context: DeliveryContext): WorkStateResult<DeliveryWorkState | null> {
	if (context.delivery.closed !== null) return ok({ type: 'closed', outcome: context.delivery.closed.type })

	return context.delivery.queued === null ? ok({ type: 'unqueued' }) : ok(null)
}

function deliveryDependencyState(context: DeliveryContext): WorkStateResult<DeliveryWorkState | null> {
	const blockedIds = blockedDeliveryIds(context)

	return blockedIds.length === 0 ? ok(null) : ok({ type: 'dependency-blocked', blockedBy: blockedIds })
}

function blockedDeliveryIds(context: DeliveryContext): Delivery['id'][] {
	return context.deliveryDependencies
		.filter((dependency) => dependency.delivery.closed === null)
		.map((dependency) => dependency.delivery)
		.sort(compareAcceptedThenId)
		.map((delivery) => delivery.id)
}

function deliveryPreflightState(deliveryActions: Action[]): WorkStateResult<DeliveryWorkState | null> {
	const latestPreflight = latestAction(deliveryActions.filter((action) => action.result.type === 'validate-preflight'))
	if (latestPreflight?.result.type !== 'validate-preflight') return ok(null)

	return preflightChecksPassed(latestPreflight.result.checks) ? ok(null) : ok({ type: 'preflight-failed', actionId: latestPreflight.id })
}

function preflightChecksPassed(checks: Extract<Action['result'], { type: 'validate-preflight' }>['checks']): boolean {
	return checks.length > 0 && checks.every((check) => check.passed)
}

function latestSliceCompletionForDelivery(context: DeliveryContext): WorkStateResult<Action | null> {
	const actionIds = sliceCompletionActionIdsForDelivery(context)
	if (!actionIds.ok) return actionIds

	return actionIds.value === null ? ok(null) : latestKnownAction(actionIds.value, context.actions)
}

function sliceCompletionActionIdsForDelivery(context: DeliveryContext): WorkStateResult<Slice['id'][] | null> {
	const actionIds: Slice['id'][] = []
	for (const slice of context.slices) {
		const completion = sliceCompletionActionId(context, slice.slice.id)
		if (!completion.ok) return completion
		if (completion.value === null) return ok(null)
		actionIds.push(completion.value)
	}

	return ok(actionIds)
}

function sliceCompletionActionId(context: DeliveryContext, sliceId: Slice['id']): WorkStateResult<Slice['id'] | null> {
	const sliceState = getSliceState(context, sliceId)
	if (!sliceState.ok) return sliceState

	return sliceState.value.type === 'complete' ? ok(sliceState.value.actionId) : ok(null)
}

function deriveCompletedSlicesDeliveryState(
	context: DeliveryContext,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	latestSliceCompletion: Action,
): WorkStateResult<DeliveryWorkState> {
	const validation = deliveryValidationContext(deliveryActions, latestSliceCompletion)
	const validationState = deliveryValidationState(deliveryActions, validation)
	if (validationState !== null) return ok(validationState)
	if (validation.latestPassedValidation === null) return ok({ type: 'needs-artifact-validation' })

	return deliveryReadyReviewState(context, deliveryActions, deliveryArtifact, validation.latestPassedValidation)
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
	context: DeliveryContext,
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	latestPassedDeliveryValidation: Action,
): WorkStateResult<DeliveryWorkState> {
	const reviewSurface = currentDeliveryReviewSurface(context, deliveryArtifact.id)
	if (!reviewSurface.ok) return reviewSurface

	const reviewState = deliveryReviewState(reviewSurface.value)
	if (reviewState !== null) return ok(reviewState)

	return deliveryReviewWaitingState(deliveryActions, deliveryArtifact, latestPassedDeliveryValidation, reviewSurface.value)
}

function deliveryReviewWaitingState(
	deliveryActions: Action[],
	deliveryArtifact: DeliveryArtifact,
	latestPassedDeliveryValidation: Action,
	reviewSurface: ReviewSurface | null,
): WorkStateResult<DeliveryWorkState> {
	const observedIntegration = latestObservedDeliveryIntegration(deliveryActions, latestPassedDeliveryValidation)
	if (observedIntegration !== null) return ok(deliveryReadyByObservationState(observedIntegration))

	return reviewSurface === null
		? ok({ type: 'needs-review-surface', deliveryArtifactId: deliveryArtifact.id })
		: ok({ type: 'awaiting-review', reviewSurfaceId: reviewSurface.id })
}

function currentDeliveryReviewSurface(
	context: DeliveryContext,
	deliveryArtifactId: DeliveryArtifact['id'],
): WorkStateResult<ReviewSurface | null> {
	return currentScopedReviewSurface(
		context.reviewSurfaces.filter(
			(reviewSurface) =>
				reviewSurface.scope.type === 'delivery' &&
				reviewSurface.scope.deliveryId === context.delivery.id &&
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

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, externalOperationEvidence, seedDelivery, seedSlice, stamp, validationEvidence } =
		await import('../../test-helpers')
	const passedValidation = validationEvidence('delivery-branch-validation', true, 'Valid.')
	const failedValidation = validationEvidence('delivery-branch-validation', false, 'Invalid.')
	const externalFailure = externalOperationEvidence('push-branch', false, 'Failed.')
	const externalPassed = externalOperationEvidence('observe-artifact-integration', true, 'Integrated.')
	const sliceValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const slicePromotion = externalOperationEvidence('merge-review-surface', true, 'Merged.')

	describe('getDeliveryState', () => {
		it('derives closed from Delivery.closed', () => {
			const { tx } = deliveryFixture()
			tx.deliveries.records.get('delivery-1')!.closed = {
				type: 'shipped',
				shipped: stamp,
				integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' },
			}

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'closed', outcome: 'shipped' },
			})
		})

		it('derives unqueued before Delivery.queued is set', () => {
			const { tx } = deliveryFixture()

			expect(deliveryState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'unqueued' } })
		})

		it('derives dependency-blocked from an unclosed same-Project prerequisite Delivery', () => {
			const { tx } = deliveryFixture({ queued: true })
			seedDelivery(tx, 'delivery-prerequisite')
			tx.links.records.set('delivery-dependency', {
				id: 'delivery-dependency',
				def: {
					type: 'depends-on',
					from: { type: 'delivery', projectId: 'project-1', id: 'delivery-1' },
					to: { type: 'delivery', projectId: 'project-1', id: 'delivery-prerequisite' },
				},
				created: stamp,
			})

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'dependency-blocked', blockedBy: ['delivery-prerequisite'] },
			})
		})

		it('derives preflight-failed from the latest failed Delivery preflight check', () => {
			const { tx } = deliveryFixture({ queued: true })
			seedAction(tx, { id: 'preflight-failed', result: { type: 'validate-preflight', checks: [failedValidation] } })

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'preflight-failed', actionId: 'preflight-failed' },
			})
		})

		it('treats empty Delivery preflight checks as failed', () => {
			const { tx } = deliveryFixture({ queued: true })
			seedAction(tx, { id: 'preflight-empty', result: { type: 'validate-preflight', checks: [] } })

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'preflight-failed', actionId: 'preflight-empty' },
			})
		})

		it('clears preflight-failed when the latest Delivery preflight checks all passed', () => {
			const { tx } = deliveryFixture({ queued: true })
			seedAction(tx, { id: 'preflight-failed', result: { type: 'validate-preflight', checks: [failedValidation] } })
			seedAction(tx, {
				id: 'preflight-passed',
				at: '2026-06-10T12:01:00.000Z',
				result: { type: 'validate-preflight', checks: [validationEvidence('repository-preflight', true, 'Repository ready.')] },
			})

			expect(deliveryState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives needs-artifact-creation after queueing before a Delivery Artifact exists', () => {
			const { tx } = deliveryFixture({ queued: true })

			expect(deliveryState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives slices-incomplete when at least one Slice is not complete', () => {
			const { tx } = deliveryFixture({ queued: true, withDeliveryArtifact: true, withSlice: true })

			expect(deliveryState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'slices-incomplete' } })
		})

		it('derives delivery-operation-failed from a Delivery-scoped external failure after passed validation', () => {
			const { tx } = completedDeliveryFixture()
			seedDeliveryValidation(tx, 'delivery-validation', true)
			seedAction(tx, {
				id: 'delivery-operation-failed',
				at: '2026-06-10T12:04:00.000Z',
				result: { type: 'record-delivery-external-operation-failure', evidence: externalFailure },
			})

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-operation-failed', actionId: 'delivery-operation-failed' },
			})
		})

		it('derives delivery-validation-failed from the latest failed Delivery Artifact validation', () => {
			const { tx } = completedDeliveryFixture()
			seedDeliveryValidation(tx, 'delivery-validation-failed', false)

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-validation-failed', actionId: 'delivery-validation-failed' },
			})
		})

		it('derives delivery-review-failed when the current Delivery Review Surface closed without merge', () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, { id: 'delivery-review', closed: { type: 'closed-without-merge', closed: { at: stamp.at } } })

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'delivery-review-failed', reviewSurfaceId: 'delivery-review' },
			})
		})

		it('derives needs-artifact-validation after all Slices complete before Delivery Artifact validation', () => {
			const { tx } = completedDeliveryFixture()

			expect(deliveryState(tx, 'delivery-1')).toEqual({ ok: true, value: { type: 'needs-artifact-validation' } })
		})

		it('derives needs-review-surface after passed Delivery Artifact validation before review exists', () => {
			const { tx } = validatedDeliveryFixture()

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'needs-review-surface', deliveryArtifactId: 'delivery-artifact-1' },
			})
		})

		it('derives awaiting-review while the current Delivery Review Surface is open', () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, { id: 'delivery-review', closed: null })

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'awaiting-review', reviewSurfaceId: 'delivery-review' },
			})
		})

		it('derives ready-to-ship when the current Delivery Review Surface is merged', () => {
			const { tx } = validatedDeliveryFixture()
			seedDeliveryReviewSurface(tx, {
				id: 'delivery-review',
				closed: {
					type: 'merged',
					merged: { at: stamp.at },
					config: { type: 'source-control', repositoryId: 'repository-1', sourceBranch: 'delivery', targetBranch: 'main' },
				},
			})

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'ready-to-ship', integration: { type: 'review-surface-merged', reviewSurfaceId: 'delivery-review' } },
			})
		})

		it('derives ready-to-ship when Delivery Artifact integration is observed after validation', () => {
			const { tx } = validatedDeliveryFixture()
			seedAction(tx, {
				id: 'observe-integration',
				at: '2026-06-10T12:04:00.000Z',
				result: { type: 'observe-delivery-artifact-integration', evidence: externalPassed },
			})

			expect(deliveryState(tx, 'delivery-1')).toEqual({
				ok: true,
				value: { type: 'ready-to-ship', integration: { type: 'observed-artifact-integration', actionId: 'observe-integration' } },
			})
		})
	})

	function deliveryFixture(options: { queued?: boolean; withDeliveryArtifact?: boolean; withSlice?: boolean } = {}) {
		const core = createTestCoreServices()
		seedDelivery(core.tx, 'delivery-1')
		if (options.withSlice === true) seedSlice(core.tx, 'slice-1', 'delivery-1')
		if (options.queued === true) core.tx.deliveries.records.get('delivery-1')!.queued = stamp
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
			closed: reviewSurface.closed,
			created: { at: stamp.at },
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

	function deliveryState(tx: ReturnType<typeof deliveryFixture>['tx'], deliveryId: string) {
		const delivery = tx.deliveries.records.get(deliveryId)
		if (delivery === undefined)
			return { ok: false, error: { type: 'not-found' as const, resource: 'delivery' as const, id: deliveryId } }

		const actions = [...tx.actions.records.values()].sort(compareActions)
		const sliceRecords = [...tx.slices.records.values()]
			.filter((slice) => slice.deliveryId === delivery.id)
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
		const sliceIds = new Set(sliceRecords.map((slice) => slice.id))
		const links = [...tx.links.records.values()]
		const slices = sliceRecords.map((slice) => ({
			slice,
			artifact: [...tx.sliceArtifacts.records.values()].find((artifact) => artifact.sliceId === slice.id) ?? null,
			dependencyLinks: links.filter(
				(link) =>
					link.def.type === 'depends-on' &&
					link.def.from.type === 'slice' &&
					link.def.from.id === slice.id &&
					link.def.to.type === 'slice',
			) as DeliveryContext['slices'][number]['dependencyLinks'],
		}))
		const deliveryDependencies = links
			.filter(
				(link) =>
					link.def.type === 'depends-on' &&
					link.def.from.type === 'delivery' &&
					link.def.from.id === delivery.id &&
					link.def.to.type === 'delivery',
			)
			.map((link) => ({ link, delivery: tx.deliveries.records.get(link.def.to.id)! }))

		return getDeliveryState({
			delivery,
			project: tx.projects.records.get(delivery.projectId)!,
			repository: tx.repositories.records.get(delivery.target.repositoryId)!,
			deliveryArtifact: [...tx.deliveryArtifacts.records.values()].find((artifact) => artifact.deliveryId === delivery.id) ?? null,
			slices,
			actions: actions.filter((action) => action.deliveryId === delivery.id),
			agentRuns: [...tx.agentRuns.records.values()].filter(
				(run) => run.purpose.type === 'execution' && run.purpose.deliveryId === delivery.id,
			),
			reviewSurfaces: [...tx.reviewSurfaces.records.values()].filter((surface) =>
				surface.scope.type === 'delivery' ? surface.scope.deliveryId === delivery.id : sliceIds.has(surface.scope.sliceId),
			),
			deliveryDependencies: deliveryDependencies as DeliveryContext['deliveryDependencies'],
		})
	}
}
