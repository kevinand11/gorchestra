import { actionAffectsSlice, latestAction, latestPassedSlicePromotion, latestSliceDeliveryValidationAfter, sortedActions } from './actions'
import { singleSliceArtifact } from './artifacts'
import { compareAcceptedThenId } from './dependencies'
import { firstSyncState, invariant, ok, stateOrElseSync } from './result'
import { currentScopedReviewSurface } from './review-surfaces'
import type { SliceDependencyLink, WorkStateDerivationError, WorkStateResult } from './types'
import type { Action } from '../../domain/action'
import type { AgentRun, ExecutionMode } from '../../domain/agent-run'
import type { ArchivePeriod, Id } from '../../domain/commons'
import type { Slice, SliceWorkState } from '../../domain/slice'
import type { StoredDeliveryContext } from '../delivery-context-types'
import { notFound } from '../storage'
import type { Result } from '../types'

export function getSliceState(context: StoredDeliveryContext, sliceId: Id): Result<SliceWorkState, WorkStateDerivationError> {
	const slice = context.slices.find((candidate) => candidate.id === sliceId && candidate.deliveryId === context.delivery.id)
	return slice === undefined ? notFound('slice', sliceId) : deriveSliceState(context, slice)
}

function deriveSliceState(context: StoredDeliveryContext, slice: Slice): WorkStateResult<SliceWorkState> {
	const sliceActions = sortedActions(context.actions.filter((action) => actionAffectsSlice(action, slice.id)))
	const earlyState = firstSyncState([() => promotedSliceState(context, slice, sliceActions), () => sliceDependencyState(context, slice)])

	return stateOrElseSync(earlyState, () => deriveSliceStateAfterEarlyGates(context, slice, sliceActions))
}

function promotedSliceState(context: StoredDeliveryContext, slice: Slice, sliceActions: Action[]): WorkStateResult<SliceWorkState | null> {
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

function sliceDependencyState(context: StoredDeliveryContext, slice: Slice): WorkStateResult<SliceWorkState | null> {
	const blockedIds = blockedSliceIds(context, slice)
	if (!blockedIds.ok) return blockedIds

	return blockedIds.value.length === 0 ? ok(null) : ok({ type: 'dependency-blocked', blockedBy: blockedIds.value })
}

function failedSliceArtifactValidationState(
	context: StoredDeliveryContext,
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
	context: StoredDeliveryContext,
	slice: Slice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState> {
	const executionState = deriveSliceExecutionState(context, slice, sliceActions)
	return stateOrElseSync(executionState, () => deriveSliceStateAfterExecution(context, slice, sliceActions))
}

function deriveSliceExecutionState(
	context: StoredDeliveryContext,
	slice: Slice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	const execution = latestCompletedSliceExecutionAgentRun(context, slice)
	return execution === null ? ok(null) : completedSliceExecutionState(context, slice, execution, sliceActions)
}

type CompletedExecutionAgentRun = AgentRun & {
	purpose: Extract<AgentRun['purpose'], { type: 'execution' }>
	completed: NonNullable<AgentRun['completed']>
}

function completedSliceExecutionState(
	context: StoredDeliveryContext,
	slice: Slice,
	execution: CompletedExecutionAgentRun,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState | null> {
	if (!executionNeedsArtifactValidation(execution, sliceActions)) return ok(null)

	const artifactResult = singleSliceArtifact(slice, context.sliceArtifacts)
	if (!artifactResult.ok) return artifactResult
	if (artifactResult.value === null) return invariant(`Completed Slice execution ${execution.id} has no Slice Artifact.`)

	return ok(needsSliceArtifactValidationState(context, slice, execution.purpose.mode, artifactResult.value.id))
}

function executionNeedsArtifactValidation(execution: CompletedExecutionAgentRun, sliceActions: Action[]): boolean {
	const latestValidation = latestAction(sliceActions.filter((action) => action.result.type === 'validate-slice-artifact'))

	return latestValidation === null || latestValidation.performed.at.localeCompare(execution.completed.at) < 0
}

function needsSliceArtifactValidationState(
	context: StoredDeliveryContext,
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
	context: StoredDeliveryContext,
	slice: Slice,
	sliceActions: Action[],
): WorkStateResult<SliceWorkState> {
	const externalState = firstSyncState([
		() => sliceReviewState(context, slice),
		() => sliceExternalFailureState(sliceActions),
		() => initialSliceArtifactState(context, slice),
		() => failedSliceArtifactValidationState(context, slice, sliceActions),
	])

	return stateOrElseSync(externalState, () => ok({ type: 'executable', mode: 'initial' }))
}

function sliceReviewState(context: StoredDeliveryContext, slice: Slice): WorkStateResult<SliceWorkState | null> {
	const reviewSurface = currentScopedReviewSurface(
		context.reviewSurfaces.filter((candidate) => candidate.scope.type === 'slice' && candidate.scope.sliceId === slice.id),
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

function initialSliceArtifactState(context: StoredDeliveryContext, slice: Slice): WorkStateResult<SliceWorkState | null> {
	const artifactResult = singleSliceArtifact(slice, context.sliceArtifacts)
	if (!artifactResult.ok) return artifactResult

	return artifactResult.value === null ? ok({ type: 'needs-artifact-creation' }) : ok(null)
}

function blockedSliceIds(context: StoredDeliveryContext, slice: Slice): WorkStateResult<Slice['id'][]> {
	const prerequisites: Slice[] = []
	for (const link of activeSliceDependencyLinks(context, slice.id)) {
		const prerequisite = incompleteSliceDependency(context, link)
		if (!prerequisite.ok) return prerequisite
		if (prerequisite.value !== null) prerequisites.push(prerequisite.value)
	}

	return ok(prerequisites.sort(compareAcceptedThenId).map((blocked) => blocked.id))
}

function incompleteSliceDependency(context: StoredDeliveryContext, link: SliceDependencyLink): WorkStateResult<Slice | null> {
	const prerequisite = context.slices.find((candidate) => candidate.id === link.to.id)
	if (prerequisite === undefined) return notFound('slice', link.to.id)

	return validSliceDependency(context, prerequisite).ok && isSliceComplete(prerequisite.id, context.actions)
		? ok(null)
		: validSliceDependency(context, prerequisite)
}

function validSliceDependency(context: StoredDeliveryContext, prerequisite: Slice): WorkStateResult<Slice> {
	return prerequisite.deliveryId === context.delivery.id
		? ok(prerequisite)
		: invariant(`Slice dependency ${prerequisite.id} is outside Delivery ${context.delivery.id}.`)
}

function activeSliceDependencyLinks(context: StoredDeliveryContext, sliceId: Slice['id']): SliceDependencyLink[] {
	return context.sliceDependencyLinks.filter((link) => link.from.id === sliceId && !isArchived(link.archivePeriods))
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	return archivePeriods.at(-1)?.unarchived === null
}

function isSliceComplete(sliceId: Slice['id'], actions: Action[]): boolean {
	const sliceActions = sortedActions(actions.filter((action) => actionAffectsSlice(action, sliceId)))
	const latestPromotion = latestPassedSlicePromotion(sliceId, sliceActions)
	if (latestPromotion === null) return false

	return latestSliceDeliveryValidationAfter(sliceId, sliceActions, latestPromotion)?.result.evidence.passed === true
}

function latestCompletedSliceExecutionAgentRun(context: StoredDeliveryContext, slice: Slice): CompletedExecutionAgentRun | null {
	return (
		sliceExecutionAgentRuns(context, slice)
			.filter((run): run is CompletedExecutionAgentRun => run.completed !== null)
			.sort(compareAgentRunsByCompletion)
			.at(-1) ?? null
	)
}

function sliceExecutionAgentRuns(
	context: StoredDeliveryContext,
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

function correctionRetriesFor(context: StoredDeliveryContext, root: Action, slice: Slice): number {
	return correctionRetriesForRoot(context, root.id, slice)
}

function correctionRetriesForRoot(context: StoredDeliveryContext, rootActionId: string, slice: Slice): number {
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
		await import('../test-helpers')
	const passedValidation = validationEvidence('slice-branch-validation', true, 'Valid.')
	const failedValidation = validationEvidence('slice-branch-validation', false, 'Invalid.')
	const externalFailure = externalOperationEvidence('push-branch', false, 'Failed.')
	const externalPassed = externalOperationEvidence('merge-review-surface', true, 'Merged.')

	describe('getSliceState', () => {
		it('derives complete after Slice Delivery Artifact validation passes after promotion', () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', 'slice-1')
			seedSliceDeliveryValidation(tx, 'slice-complete', 'slice-1', true)

			expect(sliceState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'complete', actionId: 'slice-complete' } })
		})

		it('derives needs-delivery-validation after promotion without later Slice Delivery Artifact validation', () => {
			const { tx } = sliceFixture()
			seedPromotion(tx, 'promote-slice', 'slice-1')

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'needs-delivery-validation', actionId: 'promote-slice' },
			})
		})

		it('derives dependency-blocked for an incomplete same-Delivery prerequisite Slice', () => {
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

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'dependency-blocked', blockedBy: ['slice-prerequisite'] },
			})
		})

		it('keeps a Slice executable while an initial Agent Run is incomplete', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceExecution(tx, 'start-initial', 'slice-1', 'initial', 'agent-run-1', null)

			expect(sliceState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('counts an incomplete correction Agent Run without exposing an in-transit Slice state', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', 'slice-1', false)
			seedSliceExecution(tx, 'start-correction', 'slice-1', 'correction', 'agent-run-1', null, '2026-06-10T12:01:00.000Z')

			expect(sliceState(tx, 'slice-1')).toEqual({
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
			seedSliceExecution(tx, 'start-initial', 'slice-1', 'initial', 'agent-run-1', { at: '2026-06-10T12:01:00.000Z' })

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'needs-artifact-validation', mode: 'initial', sliceArtifactId: 'slice-artifact-1' },
			})
		})

		it('derives needs-artifact-validation correction after completed correction execution', () => {
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

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: {
					type: 'needs-artifact-validation',
					mode: 'correction',
					sliceArtifactId: 'slice-artifact-1',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
			})
		})

		it('derives awaiting-review while the current Slice Review Surface is open', () => {
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

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'awaiting-review', reviewSurfaceId: 'review-surface-1' },
			})
		})

		it('derives slice-operation-failed from latest Slice external operation failure', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			tx.actions.records.set('external-failure', {
				id: 'external-failure',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'record-slice-external-operation-failure', sliceId: 'slice-1', evidence: externalFailure },
			})

			expect(sliceState(tx, 'slice-1')).toEqual({
				ok: true,
				value: { type: 'slice-operation-failed', actionId: 'external-failure' },
			})
		})

		it('derives needs-artifact-creation before a Slice Artifact exists', () => {
			const { tx } = sliceFixture()

			expect(sliceState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('derives executable initial when the Slice Artifact exists and no earlier gate applies', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })

			expect(sliceState(tx, 'slice-1')).toEqual({ ok: true, value: { type: 'executable', mode: 'initial' } })
		})

		it('derives executable correction from a failed Slice Artifact validation', () => {
			const { tx } = sliceFixture({ withSliceArtifact: true })
			seedSliceArtifactValidation(tx, 'failed-validation', 'slice-1', false)

			expect(sliceState(tx, 'slice-1')).toEqual({
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
			seedPromotion(tx, 'promote-slice', 'slice-1')
			tx.actions.records.set('delivery-validation', {
				id: 'delivery-validation',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:01:00.000Z' },
				authorized: null,
				result: { type: 'validate-delivery-artifact', evidence: passedValidation },
			})

			expect(sliceState(tx, 'slice-1')).toEqual({
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

	function sliceState(tx: ReturnType<typeof sliceFixture>['tx'], sliceId: string) {
		const delivery = tx.deliveries.records.get('delivery-1')!
		const slices = [...tx.slices.records.values()]
			.filter((slice) => slice.deliveryId === delivery.id)
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
		const sliceIds = new Set(slices.map((slice) => slice.id))
		const links = [...tx.links.records.values()]

		return getSliceState(
			{
				delivery,
				project: tx.projects.records.get(delivery.projectId)!,
				repository: tx.repositories.records.get(delivery.target.repositoryId)!,
				portfolioConfig: tx.portfolioConfig.record,
				projectConfig: tx.projects.records.get(delivery.projectId)!.config,
				slices,
				actions: [...tx.actions.records.values()].filter((action) => action.deliveryId === delivery.id),
				agentRuns: [...tx.agentRuns.records.values()].filter(
					(run) => run.purpose.type === 'execution' && run.purpose.deliveryId === delivery.id,
				),
				deliveryArtifacts: [...tx.deliveryArtifacts.records.values()].filter((artifact) => artifact.deliveryId === delivery.id),
				sliceArtifacts: [...tx.sliceArtifacts.records.values()].filter((artifact) => sliceIds.has(artifact.sliceId)),
				reviewSurfaces: [...tx.reviewSurfaces.records.values()].filter((surface) =>
					surface.scope.type === 'delivery' ? surface.scope.deliveryId === delivery.id : sliceIds.has(surface.scope.sliceId),
				),
				deliveryDependencies: [],
				sliceDependencyLinks: links.filter(
					(link) =>
						link.type === 'depends-on' && link.from.type === 'slice' && sliceIds.has(link.from.id) && link.to.type === 'slice',
				) as StoredDeliveryContext['sliceDependencyLinks'],
			},
			sliceId,
		)
	}
}
