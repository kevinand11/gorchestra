import { actionAffectsSlice, latestAction, latestPassedSlicePromotion, latestSliceDeliveryValidationAfter, sortedActions } from './actions'
import { singleSliceArtifact } from './artifacts'
import { blockedDependencyIds } from './dependencies'
import { loadWorkStateFacts } from './facts'
import { firstState, firstSyncState, invariant, ok, stateOrElse, stateOrElseSync } from './result'
import { currentScopedReviewSurface } from './review-surfaces'
import type { SliceDependencyLink, WorkStateDerivationError, WorkStateFacts, WorkStateResult } from './types'
import type { Action } from '../../domain/action'
import type { AgentRun, ExecutionMode } from '../../domain/agent-run'
import { deliveryPipe, type Delivery } from '../../domain/delivery'
import { slicePipe, type Slice, type SliceWorkState } from '../../domain/slice'
import type { CoreStorageTransaction } from '../../services'
import { getRequired } from '../storage'
import type { Result } from '../types'

export async function deriveSliceWorkState(
	tx: CoreStorageTransaction,
	sliceId: Slice['id'],
): Promise<Result<SliceWorkState, WorkStateDerivationError>> {
	const sliceResult = await getRequired('slice', tx.slices, sliceId, slicePipe)
	if (!sliceResult.ok) return sliceResult

	const factsResult = await loadWorkStateFacts(tx)
	if (!factsResult.ok) return factsResult

	return deriveSliceWorkStateFromFacts(tx, sliceResult.value, factsResult.value)
}

export async function deriveSliceWorkStateFromFacts(
	tx: CoreStorageTransaction,
	slice: Slice,
	facts: WorkStateFacts,
): Promise<WorkStateResult<SliceWorkState>> {
	const deliveryResult = await getRequired('delivery', tx.deliveries, slice.deliveryId, deliveryPipe)
	if (!deliveryResult.ok) return deliveryResult

	const deliveryActions = sortedActions(facts.actions.filter((action) => action.deliveryId === slice.deliveryId))
	const sliceActions = deliveryActions.filter((action) => actionAffectsSlice(action, slice.id))
	const earlyState = await firstState([
		() => promotedSliceState(slice, sliceActions, facts),
		() => sliceDependencyState(tx, deliveryResult.value, slice, facts),
	])

	return stateOrElse(earlyState, () => deriveSliceStateAfterEarlyGates(slice, sliceActions, facts))
}

function promotedSliceState(slice: Slice, sliceActions: Action[], facts: WorkStateFacts): WorkStateResult<SliceWorkState | null> {
	const promotion = latestPassedSlicePromotion(slice.id, sliceActions)
	if (promotion === null) return ok(null)

	const validation = latestSliceDeliveryValidationAfter(slice.id, sliceActions, promotion)
	if (validation === null) return ok({ type: 'needs-delivery-validation', actionId: promotion.id })

	return validation.result.evidence.passed
		? ok({ type: 'complete', actionId: validation.id })
		: ok({
				type: 'executable',
				mode: 'correction',
				failureChain: { rootActionId: validation.id, correctionRetries: correctionRetriesFor(validation, slice, facts) },
			})
}

async function sliceDependencyState(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	slice: Slice,
	facts: WorkStateFacts,
): Promise<WorkStateResult<SliceWorkState | null>> {
	const blockedIds = await blockedSliceIds(tx, delivery, slice, facts)
	if (!blockedIds.ok) return blockedIds

	return blockedIds.value.length === 0 ? ok(null) : ok({ type: 'dependency-blocked', blockedBy: blockedIds.value })
}

function failedSliceArtifactValidationState(
	slice: Slice,
	sliceActions: Action[],
	facts: WorkStateFacts,
): WorkStateResult<SliceWorkState | null> {
	const validation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))
	if (validation?.result.type !== 'validate-slice-artifact' || validation.result.evidence.passed) return ok(null)

	return ok({
		type: 'executable',
		mode: 'correction',
		failureChain: { rootActionId: validation.id, correctionRetries: correctionRetriesFor(validation, slice, facts) },
	})
}

function deriveSliceStateAfterEarlyGates(slice: Slice, sliceActions: Action[], facts: WorkStateFacts): WorkStateResult<SliceWorkState> {
	const executionState = deriveSliceExecutionState(slice, sliceActions, facts)
	return stateOrElseSync(executionState, () => deriveSliceStateAfterExecution(slice, sliceActions, facts))
}

function deriveSliceExecutionState(slice: Slice, sliceActions: Action[], facts: WorkStateFacts): WorkStateResult<SliceWorkState | null> {
	const execution = latestCompletedSliceExecutionAgentRun(slice, facts)
	return execution === null ? ok(null) : completedSliceExecutionState(slice, execution, sliceActions, facts)
}

type CompletedExecutionAgentRun = AgentRun & {
	purpose: Extract<AgentRun['purpose'], { type: 'execution' }>
	completed: NonNullable<AgentRun['completed']>
}

function completedSliceExecutionState(
	slice: Slice,
	execution: CompletedExecutionAgentRun,
	sliceActions: Action[],
	facts: WorkStateFacts,
): WorkStateResult<SliceWorkState | null> {
	if (!executionNeedsArtifactValidation(execution, sliceActions)) return ok(null)

	const artifactResult = singleSliceArtifact(slice, facts.sliceArtifacts)
	if (!artifactResult.ok) return artifactResult
	if (artifactResult.value === null) return invariant(`Completed Slice execution ${execution.id} has no Slice Artifact.`)

	return ok(needsSliceArtifactValidationState(slice, execution.purpose.mode, artifactResult.value.id, facts))
}

function executionNeedsArtifactValidation(execution: CompletedExecutionAgentRun, sliceActions: Action[]): boolean {
	const latestValidation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))

	return latestValidation === null || latestValidation.performed.at.localeCompare(execution.completed.at) < 0
}

function needsSliceArtifactValidationState(
	slice: Slice,
	mode: ExecutionMode,
	sliceArtifactId: string,
	facts: WorkStateFacts,
): SliceWorkState {
	return mode.type === 'correction'
		? {
				type: 'needs-artifact-validation',
				mode: 'correction',
				sliceArtifactId,
				failureChain: {
					rootActionId: mode.failureChainRootActionId,
					correctionRetries: correctionRetriesForRoot(mode.failureChainRootActionId, slice, facts),
				},
			}
		: { type: 'needs-artifact-validation', mode: 'initial', sliceArtifactId }
}

function deriveSliceStateAfterExecution(slice: Slice, sliceActions: Action[], facts: WorkStateFacts): WorkStateResult<SliceWorkState> {
	const externalState = firstSyncState([
		() => sliceReviewState(slice, facts),
		() => sliceExternalFailureState(sliceActions),
		() => initialSliceArtifactState(slice, facts),
		() => failedSliceArtifactValidationState(slice, sliceActions, facts),
	])

	return stateOrElseSync(externalState, () => ok({ type: 'executable', mode: 'initial' }))
}

function sliceReviewState(slice: Slice, facts: WorkStateFacts): WorkStateResult<SliceWorkState | null> {
	const reviewSurface = currentScopedReviewSurface(
		facts.reviewSurfaces.filter((candidate) => candidate.scope.type === 'slice' && candidate.scope.sliceId === slice.id),
	)
	if (!reviewSurface.ok) return reviewSurface

	return reviewSurface.value !== null && reviewSurface.value.closed === null
		? ok({ type: 'awaiting-review', reviewSurfaceId: reviewSurface.value.id })
		: ok(null)
}

function sliceExternalFailureState(sliceActions: Action[]): WorkStateResult<SliceWorkState | null> {
	const failure = latestAction(sliceActions.filter((action) => action.result.type === 'record-slice-external-operation-failure'))

	return failure === null ? ok(null) : ok({ type: 'slice-operation-failed', actionId: failure.id })
}

function initialSliceArtifactState(slice: Slice, facts: WorkStateFacts): WorkStateResult<SliceWorkState | null> {
	const artifactResult = singleSliceArtifact(slice, facts.sliceArtifacts)
	if (!artifactResult.ok) return artifactResult

	return artifactResult.value === null ? ok({ type: 'needs-artifact-creation' }) : ok(null)
}

async function blockedSliceIds(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	slice: Slice,
	facts: WorkStateFacts,
): Promise<WorkStateResult<Slice['id'][]>> {
	return blockedDependencyIds(
		facts.links,
		(candidate): candidate is SliceDependencyLink => isSliceDependencyLink(candidate, slice.id),
		(link) => incompleteSliceDependency(tx, delivery, link, facts.actions),
	)
}

function isSliceDependencyLink(link: WorkStateFacts['links'][number], sliceId: Slice['id']): link is SliceDependencyLink {
	return link.type === 'depends-on' && link.from.type === 'slice' && link.from.id === sliceId && link.to.type === 'slice'
}

async function incompleteSliceDependency(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	link: SliceDependencyLink,
	actions: Action[],
): Promise<WorkStateResult<Slice | null>> {
	const prerequisite = await getRequired('slice', tx.slices, link.to.id, slicePipe)
	if (!prerequisite.ok) return prerequisite
	if (prerequisite.value.deliveryId !== delivery.id)
		return invariant(`Slice dependency ${prerequisite.value.id} is outside Delivery ${delivery.id}.`)

	return isSliceComplete(prerequisite.value.id, actions) ? ok(null) : ok(prerequisite.value)
}

function isSliceComplete(sliceId: Slice['id'], actions: Action[]): boolean {
	const sliceActions = sortedActions(actions.filter((action) => actionAffectsSlice(action, sliceId)))
	const latestPromotion = latestPassedSlicePromotion(sliceId, sliceActions)
	if (latestPromotion === null) return false

	return latestSliceDeliveryValidationAfter(sliceId, sliceActions, latestPromotion)?.result.evidence.passed === true
}

function latestCompletedSliceExecutionAgentRun(slice: Slice, facts: WorkStateFacts): CompletedExecutionAgentRun | null {
	return (
		sliceExecutionAgentRuns(slice, facts)
			.filter((run): run is CompletedExecutionAgentRun => run.completed !== null)
			.sort(compareAgentRunsByCompletion)
			.at(-1) ?? null
	)
}

function sliceExecutionAgentRuns(
	slice: Slice,
	facts: WorkStateFacts,
): Array<AgentRun & { purpose: Extract<AgentRun['purpose'], { type: 'execution' }> }> {
	return facts.agentRuns.filter(
		(run): run is AgentRun & { purpose: Extract<AgentRun['purpose'], { type: 'execution' }> } =>
			run.purpose.type === 'execution' && run.purpose.deliveryId === slice.deliveryId && run.purpose.sliceId === slice.id,
	)
}

function compareAgentRunsByCompletion(left: CompletedExecutionAgentRun, right: CompletedExecutionAgentRun): number {
	const byCompletion = left.completed.at.localeCompare(right.completed.at)
	if (byCompletion !== 0) return byCompletion

	const byStart = left.started.at.localeCompare(right.started.at)
	return byStart !== 0 ? byStart : left.id.localeCompare(right.id)
}

function correctionRetriesFor(root: Action, slice: Slice, facts: WorkStateFacts): number {
	return correctionRetriesForRoot(root.id, slice, facts)
}

function correctionRetriesForRoot(rootActionId: string, slice: Slice, facts: WorkStateFacts): number {
	return facts.agentRuns.filter(
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
		await import('../test-helpers')
	const passedValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const failedValidation = validationEvidence('slice-branch-validation', false, 'Invalid.')
	const externalFailure = externalOperationEvidence('push-branch', false, 'Failed.')
	const externalPassed = externalOperationEvidence('merge-review-surface', true, 'Merged.')

	describe('deriveSliceWorkState', () => {
		it('derives complete after Slice Delivery Artifact validation passes after promotion', async () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', 'slice-1')
			seedSliceDeliveryValidation(tx, 'slice-complete', 'slice-1', true)

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'complete', actionId: 'slice-complete' } })
		})

		it('derives needs-delivery-validation after promotion without later Slice Delivery Artifact validation', async () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', 'slice-1')

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'needs-delivery-validation', actionId: 'promote-slice' },
			})
		})

		it('derives dependency-blocked for an incomplete same-Delivery prerequisite Slice', async () => {
			const { tx } = sliceFixture()
			seedSlice(tx, 'slice-prerequisite', 'delivery-1')
			tx.links.records.set('slice-dependency', {
				id: 'slice-dependency',
				type: 'depends-on',
				from: { type: 'slice', id: 'slice-1' },
				to: { type: 'slice', id: 'slice-prerequisite' },
				created: stamp,
				archivePeriods: [],
			})

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'dependency-blocked', blockedBy: ['slice-prerequisite'] },
			})
		})

		it('keeps a Slice executable while an initial Agent Run is incomplete', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceExecution(tx, 'start-initial', 'slice-1', 'initial', 'agent-run-1', null)

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('counts an incomplete correction Agent Run without exposing an in-transit Slice state', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', 'slice-1', false)
			seedSliceExecution(tx, 'start-correction', 'slice-1', 'correction', 'agent-run-1', null, '2026-06-10T12:01:00.000Z')

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: {
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
			})
		})

		it('derives needs-artifact-validation initial after completed initial execution', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceExecution(tx, 'start-initial', 'slice-1', 'initial', 'agent-run-1', { at: '2026-06-10T12:01:00.000Z' })

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'needs-artifact-validation', mode: 'initial', sliceArtifactId: 'slice-artifact-1' },
			})
		})

		it('derives needs-artifact-validation correction after completed correction execution', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', 'slice-1', false)
			seedSliceExecution(
				tx,
				'start-correction',
				'slice-1',
				'correction',
				'agent-run-1',
				{ at: '2026-06-10T12:02:00.000Z' },
				'2026-06-10T12:01:00.000Z',
			)

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: {
					type: 'needs-artifact-validation',
					mode: 'correction',
					sliceArtifactId: 'slice-artifact-1',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
			})
		})

		it('derives awaiting-review while the current Slice Review Surface is open', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			tx.reviewSurfaces.records.set('review-surface-1', {
				id: 'review-surface-1',
				scope: { type: 'slice', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
				config: reviewSurfaceConfig(),
				title: 'Review',
				body: 'Review body',
				closed: null,
				created: stamp,
			})

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'awaiting-review', reviewSurfaceId: 'review-surface-1' },
			})
		})

		it('derives slice-operation-failed from latest Slice external operation failure', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			tx.actions.records.set('external-failure', {
				id: 'external-failure',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'record-slice-external-operation-failure', sliceId: 'slice-1', evidence: externalFailure },
			})

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'slice-operation-failed', actionId: 'external-failure' },
			})
		})

		it('derives needs-artifact-creation before a Slice Artifact exists', async () => {
			const { tx } = sliceFixture()

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives executable initial when the Slice Artifact exists and no earlier gate applies', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('derives executable correction from a failed Slice Artifact validation', async () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', 'slice-1', false)

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: {
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 0 },
				},
			})
		})

		it('does not treat Delivery-level artifact validation as Slice completion', async () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', 'slice-1')
			tx.actions.records.set('delivery-validation', {
				id: 'delivery-validation',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:01:00.000Z' },
				authorized: null,
				result: { type: 'validate-delivery-artifact', evidence: passedValidation },
			})

			expect(await deriveSliceWorkState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'needs-delivery-validation', actionId: 'promote-slice' },
			})
		})
	})

	function sliceFixture(options: { withSliceArtifact?: boolean } = {}) {
		const core = createTestCoreServices()
		seedDelivery(core.tx, 'delivery-1')
		seedSlice(core.tx, 'slice-1', 'delivery-1')
		if (options.withSliceArtifact === true) {
			core.tx.sliceArtifacts.records.set('slice-artifact-1', {
				id: 'slice-artifact-1',
				sliceId: 'slice-1',
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
			agent: { type: 'model', modelId: 'model-1' },
			purpose: {
				type: 'execution',
				deliveryId: 'delivery-1',
				sliceId,
				mode: mode === 'initial' ? { type: 'initial' } : { type: 'correction', failureChainRootActionId: 'failed-validation' },
			},
			started: { at },
			completed,
		})
	}

	function seedSliceArtifactValidation(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string, passed: boolean) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: { type: 'validate-slice-artifact', sliceId, evidence: passed ? passedValidation : failedValidation },
		})
	}

	function seedPromotion(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:00:00.000Z' },
			authorized: null,
			result: { type: 'promote-slice-artifact', sliceId, evidence: externalPassed },
		})
	}

	function seedSliceDeliveryValidation(tx: ReturnType<typeof sliceFixture>['tx'], actionId: string, sliceId: string, passed: boolean) {
		tx.actions.records.set(actionId, {
			id: actionId,
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T12:01:00.000Z' },
			authorized: null,
			result: { type: 'validate-slice-delivery-artifact', sliceId, evidence: passed ? passedValidation : failedValidation },
		})
	}

	function reviewSurfaceConfig() {
		return {
			provider: 'github' as const,
			pullRequestNumber: 1,
			repositoryId: 'repository-1',
			sourceBranch: 'slice-branch',
			targetBranch: 'delivery-branch',
		}
	}
}
