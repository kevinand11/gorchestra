import {
	actionAffectsSlice,
	compareActions,
	latestAction,
	latestInTransitDispatchForOperation,
	latestPassedSlicePromotion,
	latestSliceDeliveryValidationAfter,
} from './actions'
import { compareAcceptedThenId } from './dependencies'
import { firstSyncState, invariant, ok, stateOrElseSync } from './result'
import { currentScopedReviewSurface } from './review-surfaces'
import type { SliceDependencyLink, WorkStateDerivationError, WorkStateResult } from './types'
import type { Action } from '../../../domain/action'
import type { AgentRun, ExecutionMode } from '../../../domain/agent-run'
import type { Id } from '../../../domain/commons'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { notFound } from '../../../storage/helpers'
import type { Result } from '../../types'
import type { DeliveryContext, DeliveryContextSlice } from '../types'

export function getSliceState(context: DeliveryContext, sliceId: Id): Result<SliceWorkState, WorkStateDerivationError> {
	const slice = context.slices.find((candidate) => candidate.slice.id === sliceId && candidate.slice.deliveryId === context.delivery.id)
	return slice === undefined ? notFound('slice', sliceId) : deriveSliceState(context, slice)
}

function deriveSliceState(context: DeliveryContext, storedSlice: DeliveryContextSlice): WorkStateResult<SliceWorkState> {
	const sliceActions = context.actions.filter((action) => actionAffectsSlice(action, storedSlice.slice.id))
	const earlyState = firstSyncState([
		() => completeSliceState(storedSlice.slice, sliceActions),
		() => sliceDispatchState(context, storedSlice.slice),
		() => promotedSliceState(context, storedSlice.slice, sliceActions),
		() => sliceDependencyState(context, storedSlice),
	])

	return stateOrElseSync(earlyState, () => deriveSliceStateAfterEarlyGates(context, storedSlice, sliceActions))
}

function completeSliceState(slice: Slice, sliceActions: Action[]): WorkStateResult<SliceWorkState | null> {
	const promotion = latestPassedSlicePromotion(slice.id, sliceActions)
	if (promotion === null) return ok(null)

	const validation = latestSliceDeliveryValidationAfter(slice.id, sliceActions, promotion)
	return validation?.result.evidence.passed === true ? ok({ type: 'complete', actionId: validation.id }) : ok(null)
}

function sliceDispatchState(context: DeliveryContext, slice: Slice): WorkStateResult<SliceWorkState | null> {
	const inTransit = latestInTransitDispatchForOperation(
		context.actions,
		(operation) => operation.scope === 'slice' && operation.sliceId === slice.id,
	)
	if (inTransit === null) return ok(null)

	return inTransit.type === 'running'
		? ok({ type: 'operation-running', operation: inTransit.action.result.operation, startedActionId: inTransit.action.id })
		: ok({ type: 'operation-queued', operation: inTransit.action.result.operation, queuedActionId: inTransit.action.id })
}

function promotedSliceState(context: DeliveryContext, slice: Slice, sliceActions: Action[]): WorkStateResult<SliceWorkState | null> {
	const promotion = latestPassedSlicePromotion(slice.id, sliceActions)
	if (promotion === null) return ok(null)

	const validation = latestSliceDeliveryValidationAfter(slice.id, sliceActions, promotion)
	if (validation === null) return ok({ type: 'needs-delivery-validation', actionId: promotion.id })

	return validation.result.evidence.passed
		? ok({ type: 'complete', actionId: validation.id })
		: ok({
				type: 'executable',
				mode: 'correction',
				failureChain: { rootActionId: validation.id, correctionRetries: correctionRetriesFor(context, validation, slice) },
			})
}

function sliceDependencyState(context: DeliveryContext, slice: DeliveryContextSlice): WorkStateResult<SliceWorkState | null> {
	const blockedIds = blockedSliceIds(context, slice)
	if (!blockedIds.ok) return blockedIds

	return blockedIds.value.length === 0 ? ok(null) : ok({ type: 'dependency-blocked', blockedBy: blockedIds.value })
}

function failedSliceArtifactValidationState(
	context: DeliveryContext,
	slice: Slice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	const validation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))
	if (validation?.result.type !== 'validate-slice-artifact' || validation.result.evidence.passed) return ok(null)

	return ok({
		type: 'executable',
		mode: 'correction',
		failureChain: { rootActionId: validation.id, correctionRetries: correctionRetriesFor(context, validation, slice) },
	})
}

function deriveSliceStateAfterEarlyGates(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState> {
	const executionState = deriveSliceExecutionState(context, storedSlice, sliceActions)
	return stateOrElseSync(executionState, () => deriveSliceStateAfterExecution(context, storedSlice, sliceActions))
}

function deriveSliceExecutionState(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	const execution = latestCompletedSliceExecutionAgentRun(context, storedSlice.slice)
	return execution === null ? ok(null) : completedSliceExecutionState(context, storedSlice, execution, sliceActions)
}

type CompletedExecutionAgentRun = AgentRun & {
	purpose: Extract<AgentRun['purpose'], { type: 'execution' }>
	completed: NonNullable<AgentRun['completed']>
}

function completedSliceExecutionState(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	execution: CompletedExecutionAgentRun,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	if (!executionNeedsArtifactValidation(execution, sliceActions)) return ok(null)
	if (storedSlice.artifact === null) return invariant(`Completed Slice execution ${execution.id} has no Slice Artifact.`)

	return ok(needsSliceArtifactValidationState(context, storedSlice.slice, execution.purpose.mode, storedSlice.artifact.id))
}

function executionNeedsArtifactValidation(execution: CompletedExecutionAgentRun, sliceActions: Action[]): boolean {
	const latestValidation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))

	return latestValidation === null || latestValidation.performed.at.localeCompare(execution.completed.at) < 0
}

function needsSliceArtifactValidationState(
	context: DeliveryContext,
	slice: Slice,
	mode: ExecutionMode,
	sliceArtifactId: string,
): SliceWorkState {
	return mode.type === 'correction'
		? {
				type: 'needs-artifact-validation',
				mode: 'correction',
				sliceArtifactId,
				failureChain: {
					rootActionId: mode.failureChainRootActionId,
					correctionRetries: correctionRetriesForRoot(context, mode.failureChainRootActionId, slice),
				},
			}
		: { type: 'needs-artifact-validation', mode: 'initial', sliceArtifactId }
}

function deriveSliceStateAfterExecution(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState> {
	const externalState = firstSyncState([
		() => sliceReviewWaitingState(context, storedSlice, sliceActions),
		() => sliceExternalFailureState(sliceActions),
		() => initialSliceArtifactState(storedSlice),
		() => failedSliceArtifactValidationState(context, storedSlice.slice, sliceActions),
	])

	return stateOrElseSync(externalState, () => ok({ type: 'executable', mode: 'initial' }))
}

function sliceReviewWaitingState(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	const validation = latestPassedSliceArtifactValidation(sliceActions)
	if (validation === null) return ok(null)

	return storedSlice.artifact === null
		? invariant(`Passed Slice Artifact validation ${validation.id} has no Slice Artifact.`)
		: sliceReviewStateAfterValidation(context, storedSlice, storedSlice.artifact.id)
}

function latestPassedSliceArtifactValidation(sliceActions: Action[]): Action | null {
	const validation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))
	return validation?.result.type === 'validate-slice-artifact' && validation.result.evidence.passed ? validation : null
}

function sliceReviewStateAfterValidation(
	context: DeliveryContext,
	storedSlice: DeliveryContextSlice,
	sliceArtifactId: string,
): WorkStateResult<SliceWorkState> {
	const reviewSurface = currentScopedReviewSurface(
		context.reviewSurfaces.filter((candidate) => candidate.scope.type === 'slice' && candidate.scope.sliceId === storedSlice.slice.id),
	)
	if (!reviewSurface.ok) return reviewSurface

	return reviewSurface.value !== null && reviewSurface.value.closed === null
		? ok({ type: 'awaiting-review', reviewSurfaceId: reviewSurface.value.id })
		: ok({ type: 'needs-review-surface', sliceArtifactId })
}

function sliceExternalFailureState(sliceActions: Action[]): WorkStateResult<SliceWorkState | null> {
	const failure = latestAction(sliceActions.filter((action) => action.result.type === 'record-slice-external-operation-failure'))

	return failure === null ? ok(null) : ok({ type: 'slice-operation-failed', actionId: failure.id })
}

function initialSliceArtifactState(slice: DeliveryContextSlice): WorkStateResult<SliceWorkState | null> {
	return slice.artifact === null ? ok({ type: 'needs-artifact-creation' }) : ok(null)
}

function blockedSliceIds(context: DeliveryContext, slice: DeliveryContextSlice): WorkStateResult<Slice['id'][]> {
	const prerequisites: Slice[] = []
	for (const link of activeSliceDependencyLinks(slice)) {
		const prerequisite = incompleteSliceDependency(context, link)
		if (!prerequisite.ok) return prerequisite
		if (prerequisite.value !== null) prerequisites.push(prerequisite.value)
	}

	return ok(prerequisites.sort(compareAcceptedThenId).map((blocked) => blocked.id))
}

function incompleteSliceDependency(context: DeliveryContext, link: SliceDependencyLink): WorkStateResult<Slice | null> {
	const prerequisite = context.slices.find((candidate) => candidate.slice.id === link.def.to.id)
	if (prerequisite === undefined) return notFound('slice', link.def.to.id)

	return validSliceDependency(context, prerequisite.slice).ok && isSliceComplete(prerequisite.slice.id, context.actions)
		? ok(null)
		: validSliceDependency(context, prerequisite.slice)
}

function validSliceDependency(context: DeliveryContext, prerequisite: Slice): WorkStateResult<Slice> {
	return prerequisite.deliveryId === context.delivery.id
		? ok(prerequisite)
		: invariant(`Slice dependency ${prerequisite.id} is outside Delivery ${context.delivery.id}.`)
}

function activeSliceDependencyLinks(slice: DeliveryContextSlice): SliceDependencyLink[] {
	return slice.dependencyLinks
}

function isSliceComplete(sliceId: Slice['id'], actions: Action[]): boolean {
	const sliceActions = actions.filter((action) => actionAffectsSlice(action, sliceId))
	const latestPromotion = latestPassedSlicePromotion(sliceId, sliceActions)
	if (latestPromotion === null) return false

	return latestSliceDeliveryValidationAfter(sliceId, sliceActions, latestPromotion)?.result.evidence.passed === true
}

function latestCompletedSliceExecutionAgentRun(context: DeliveryContext, slice: Slice): CompletedExecutionAgentRun | null {
	return (
		sliceExecutionAgentRuns(context, slice)
			.filter((run): run is CompletedExecutionAgentRun => run.completed !== null)
			.sort(compareAgentRunsByCompletion)
			.at(-1) ?? null
	)
}

function sliceExecutionAgentRuns(
	context: DeliveryContext,
	slice: Slice,
): Array<AgentRun & { purpose: Extract<AgentRun['purpose'], { type: 'execution' }> }> {
	return context.agentRuns.filter(
		(run): run is AgentRun & { purpose: Extract<AgentRun['purpose'], { type: 'execution' }> } =>
			run.purpose.type === 'execution' && run.purpose.deliveryId === context.delivery.id && run.purpose.sliceId === slice.id,
	)
}

function compareAgentRunsByCompletion(left: CompletedExecutionAgentRun, right: CompletedExecutionAgentRun): number {
	const byCompletion = left.completed.at.localeCompare(right.completed.at)
	if (byCompletion !== 0) return byCompletion

	const byStart = left.started.at.localeCompare(right.started.at)
	return byStart !== 0 ? byStart : left.id.localeCompare(right.id)
}

function correctionRetriesFor(context: DeliveryContext, root: Action, slice: Slice): number {
	return correctionRetriesForRoot(context, root.id, slice)
}

function correctionRetriesForRoot(context: DeliveryContext, rootActionId: string, slice: Slice): number {
	return context.agentRuns.filter(
		(run) =>
			run.purpose.type === 'execution' &&
			run.purpose.sliceId === slice.id &&
			run.purpose.mode.type === 'correction' &&
			run.purpose.mode.failureChainRootActionId === rootActionId,
	).length
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, externalOperationEvidence, seedDelivery, seedSlice, stamp, validationEvidence } =
		await import('../../test-helpers')
	const passedValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const failedValidation = validationEvidence('slice-branch-validation', false, 'Invalid.')
	const externalFailure = externalOperationEvidence('push-branch', false, 'Failed.')
	const externalPassed = externalOperationEvidence('merge-review-surface', true, 'Merged.')

	describe('getSliceState', () => {
		it('derives complete after Slice Delivery Artifact validation passes after promotion', () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', '01k00000000000000000000042')
			seedSliceDeliveryValidation(tx, '01k00000000000000000100043', '01k00000000000000000000042', true)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'complete', actionId: '01k00000000000000000100043' },
			})
		})

		it('derives needs-delivery-validation after promotion without later Slice Delivery Artifact validation', () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', '01k00000000000000000000042')

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'needs-delivery-validation', actionId: 'promote-slice' },
			})
		})

		it('derives dependency-blocked for an incomplete same-Delivery prerequisite Slice', () => {
			const { tx } = sliceFixture()
			seedSlice(tx, '01k00000000000000000100041', '01k00000000000000000000008')
			tx.links.records.set('01k00000000000000000100042', {
				id: '01k00000000000000000100042',
				def: {
					type: 'depends-on',
					from: {
						type: 'slice',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000000008',
						id: '01k00000000000000000000042',
					},
					to: {
						type: 'slice',
						projectId: '01k00000000000000000000030',
						deliveryId: '01k00000000000000000000008',
						id: '01k00000000000000000100041',
					},
				},
				created: stamp,
			})

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'dependency-blocked', blockedBy: ['01k00000000000000000100041'] },
			})
		})

		it('keeps a Slice executable while an initial Agent Run is incomplete', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceExecution(tx, 'start-initial', '01k00000000000000000000042', 'initial', '01k00000000000000000000002', null)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('counts an incomplete correction Agent Run without exposing an in-transit Slice state', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', '01k00000000000000000000042', false)
			seedSliceExecution(
				tx,
				'start-correction',
				'01k00000000000000000000042',
				'correction',
				'01k00000000000000000000002',
				null,
				'2026-06-10T12:01:00.000Z',
			)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: {
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
			})
		})

		it('derives needs-artifact-validation initial after completed initial execution', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceExecution(tx, 'start-initial', '01k00000000000000000000042', 'initial', '01k00000000000000000000002', {
				at: '2026-06-10T12:01:00.000Z',
			})

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'needs-artifact-validation', mode: 'initial', sliceArtifactId: '01k00000000000000000000045' },
			})
		})

		it('derives needs-artifact-validation correction after completed correction execution', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', '01k00000000000000000000042', false)
			seedSliceExecution(
				tx,
				'start-correction',
				'01k00000000000000000000042',
				'correction',
				'01k00000000000000000000002',
				{ at: '2026-06-10T12:02:00.000Z' },
				'2026-06-10T12:01:00.000Z',
			)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: {
					type: 'needs-artifact-validation',
					mode: 'correction',
					sliceArtifactId: '01k00000000000000000000045',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
			})
		})

		it('derives needs-review-surface after passed Slice Artifact validation before review exists', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'passed-validation', '01k00000000000000000000042', true)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'needs-review-surface', sliceArtifactId: '01k00000000000000000000045' },
			})
		})

		it('derives awaiting-review while the current Slice Review Surface is open', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'passed-validation', '01k00000000000000000000042', true)
			tx.reviewSurfaces.records.set('01k00000000000000000000037', {
				id: '01k00000000000000000000037',
				scope: { type: 'slice', sliceId: '01k00000000000000000000042', sliceArtifactId: '01k00000000000000000000045' },
				config: reviewSurfaceConfig(),
				title: 'Review',
				closed: null,
				created: { at: stamp.at },
			})

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'awaiting-review', reviewSurfaceId: '01k00000000000000000000037' },
			})
		})

		it('derives slice-operation-failed from latest Slice external operation failure', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			tx.actions.records.set('external-failure', {
				id: 'external-failure',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'record-slice-external-operation-failure',
					sliceId: '01k00000000000000000000042',
					evidence: externalFailure,
					dispatchStartedActionId: null,
				},
			})

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'slice-operation-failed', actionId: 'external-failure' },
			})
		})

		it('derives needs-artifact-creation before a Slice Artifact exists', () => {
			const { tx } = sliceFixture()

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives executable initial when the Slice Artifact exists and no earlier gate applies', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('derives executable correction from a failed Slice Artifact validation', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', '01k00000000000000000000042', false)

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: {
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 0 },
				},
			})
		})

		it('does not treat Delivery-level artifact validation as Slice completion', () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', '01k00000000000000000000042')
			tx.actions.records.set('delivery-validation', {
				id: 'delivery-validation',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:01:00.000Z' },
				authorized: null,
				result: { type: 'validate-delivery-artifact', evidence: passedValidation, dispatchStartedActionId: null },
			})

			expect(sliceState(tx, '01k00000000000000000000042')).toEqual({
				ok: true,
				value: { type: 'needs-delivery-validation', actionId: 'promote-slice' },
			})
		})
	})

	function sliceFixture(options: { withSliceArtifact?: boolean } = {}) {
		const core = createTestCoreServices()
		seedDelivery(core.tx, '01k00000000000000000000008')
		seedSlice(core.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		if (options.withSliceArtifact === true) {
			core.tx.sliceArtifacts.records.set('01k00000000000000000000045', {
				id: '01k00000000000000000000045',
				sliceId: '01k00000000000000000000042',
				config: { type: 'source-control', sliceBranch: 'slice-branch' },
				created: stamp,
			})
		}

		return core
	}

	function seedSliceExecution(
		tx: ReturnType<typeof sliceFixture>['tx'],
		_actionId: string,
		sliceId: string,
		mode: 'initial' | 'correction',
		agentRunId: string,
		completed: { at: string } | null,
		at = '2026-06-10T12:00:00.000Z',
	) {
		tx.agentRuns.records.set(agentRunId, {
			id: agentRunId,
			agent: { type: 'model' },
			purpose: {
				type: 'execution',
				deliveryId: '01k00000000000000000000008',
				sliceId,
				mode: mode === 'initial' ? { type: 'initial' } : { type: 'correction', failureChainRootActionId: 'failed-validation' },
			},
			profile: {
				agentRunProfileId: '01k00000000000000000000006',
				name: 'Agent Run Profile',
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				runtimeRequirements: [],
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: { assignment: null, appliedRequirements: [], appliedThroughEventId: null, released: null },
			started: { at },
			completed,
		})
	}

	function seedSliceArtifactValidation(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string, passed: boolean) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: '01k00000000000000000000008',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: {
				type: 'validate-slice-artifact',
				sliceId,
				evidence: passed ? passedValidation : failedValidation,
				dispatchStartedActionId: null,
			},
		})
	}

	function seedPromotion(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: '01k00000000000000000000008',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: { type: 'promote-slice-artifact', sliceId, evidence: externalPassed, dispatchStartedActionId: null },
		})
	}

	function seedSliceDeliveryValidation(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string, passed: boolean) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: '01k00000000000000000000008',
			performed: { at: '2026-06-10T12:01:00.000Z' },
			authorized: null,
			result: {
				type: 'validate-slice-delivery-artifact',
				sliceId,
				evidence: passed ? passedValidation : failedValidation,
				dispatchStartedActionId: null,
			},
		})
	}

	function reviewSurfaceConfig() {
		return {
			provider: 'github' as const,
			pullRequestNumber: 1,
			repositoryId: '01k00000000000000000000034',
			sourceBranch: 'slice-branch',
			targetBranch: 'delivery-branch',
		}
	}

	function sliceState(tx: ReturnType<typeof sliceFixture>['tx'], sliceId: string) {
		const delivery = tx.deliveries.records.get('01k00000000000000000000008')!
		const sliceRecords = [...tx.slices.records.values()]
			.filter((slice) => slice.deliveryId === delivery.id)
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
		const sliceIds = new Set(sliceRecords.map((slice) => slice.id))
		const links = [...tx.links.records.values()]
		const slices = sliceRecords.reduce<DeliveryContext['slices']>((entries, slice) => {
			entries.push({
				slice,
				artifact: [...tx.sliceArtifacts.records.values()].find((artifact) => artifact.sliceId === slice.id) ?? null,
				dependencyLinks: links.filter(
					(link): link is DeliveryContext['slices'][number]['dependencyLinks'][number] =>
						link.def.type === 'depends-on' &&
						link.def.from.type === 'slice' &&
						link.def.from.id === slice.id &&
						link.def.to.type === 'slice',
				),
			})
			return entries
		}, [])

		return getSliceState(
			{
				delivery,
				project: tx.projects.records.get(delivery.projectId)!,
				repository: tx.repositories.records.get(delivery.target.repositoryId)!,
				deliveryArtifact:
					[...tx.deliveryArtifacts.records.values()].find((artifact) => artifact.deliveryId === delivery.id) ?? null,
				slices,
				actions: [...tx.actions.records.values()].sort(compareActions).filter((action) => action.deliveryId === delivery.id),
				agentRuns: [...tx.agentRuns.records.values()].filter(
					(run) => run.purpose.type === 'execution' && run.purpose.deliveryId === delivery.id,
				),
				reviewSurfaces: [...tx.reviewSurfaces.records.values()].filter((surface) =>
					surface.scope.type === 'delivery' ? surface.scope.deliveryId === delivery.id : sliceIds.has(surface.scope.sliceId),
				),
				deliveryDependencies: [],
			},
			sliceId,
		)
	}
}
