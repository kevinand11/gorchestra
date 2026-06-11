import type { DependencyNode, ReplacedReviewSurface, SliceDeliveryValidationAction, WorkStateResult } from './types'
import type { Action, ActionResult } from '../../domain/action'
import type { AgentRun } from '../../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../../domain/artifact'
import type { ArchivePeriod, Id } from '../../domain/commons'
import type { Link } from '../../domain/graph'
import type { ReviewSurface } from '../../domain/review-surface'
import type { FailureChain, Slice } from '../../domain/slice'
import type { InvariantViolationError } from '../../errors'
import type { Result } from '../types'

export function latestPassedSlicePromotion(sliceId: Id, sliceActions: Action[]): Action | null {
	return latestAction(
		sliceActions.filter(
			(action) =>
				action.result.type === 'promote-slice-artifact' && action.result.sliceId === sliceId && action.result.evidence.passed,
		),
	)
}

export function latestSliceDeliveryValidationAfter(
	sliceId: Id,
	sliceActions: Action[],
	promotion: Action,
): SliceDeliveryValidationAction | null {
	return latestAction(
		sliceActions
			.filter(isSliceDeliveryValidationAction)
			.filter((action) => action.result.sliceId === sliceId && compareActions(action, promotion) > 0),
	)
}

export function actionAffectsSlice(action: Action, sliceId: Id): boolean {
	return actionResultSliceId(action.result) === sliceId
}

export function singleDeliveryArtifact(
	deliveryId: Id,
	artifacts: DeliveryArtifact[],
): Result<DeliveryArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.deliveryId === deliveryId)
	if (matching.length > 1) return invariant(`Delivery ${deliveryId} has multiple Delivery Artifacts.`)

	return ok(matching[0] ?? null)
}

export function singleSliceArtifact(slice: Slice, artifacts: SliceArtifact[]): Result<SliceArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.sliceId === slice.id)
	if (matching.length > 1) return invariant(`Slice ${slice.id} has multiple Slice Artifacts.`)

	return ok(matching[0] ?? null)
}

export function currentScopedReviewSurface(reviewSurfaces: ReviewSurface[]): WorkStateResult<ReviewSurface | null> {
	const first = firstReviewSurface(reviewSurfaces)
	if (first === null) return ok(null)

	return followReviewSurfaceReplacementChain(first, new Map(reviewSurfaces.map((reviewSurface) => [reviewSurface.id, reviewSurface])))
}

export function latestKnownAction(actionIds: Id[], actions: Action[]): WorkStateResult<Action | null> {
	const byId = new Map(actions.map((action) => [action.id, action]))
	const known: Action[] = []
	for (const actionId of actionIds) {
		const action = byId.get(actionId)
		if (action === undefined) return invariant(`Action ${actionId} is missing.`)
		known.push(action)
	}

	return ok(latestAction(known))
}

export function getKnownAgentRun(agentRunId: Id, agentRuns: AgentRun[]): WorkStateResult<AgentRun> {
	const agentRun = agentRuns.find((run) => run.id === agentRunId)
	return agentRun === undefined ? invariant(`Agent Run ${agentRunId} is missing.`) : ok(agentRun)
}

export function latestFailureChainBefore(action: Action, sliceActions: Action[]): FailureChain {
	const failedAction = latestAction(sliceActions.filter((candidate) => isFailureChainRootCandidate(candidate, action)))

	return failedAction === null ? { rootActionId: action.id, correctionRetries: 0 } : failureChainFromRoot(failedAction, sliceActions)
}

export async function firstState<T>(
	steps: Array<() => WorkStateResult<T | null> | Promise<WorkStateResult<T | null>>>,
): Promise<WorkStateResult<T | null>> {
	for (const step of steps) {
		const result = await step()
		if (!result.ok) return result
		if (result.value !== null) return result
	}

	return ok(null)
}

export function firstSyncState<T>(steps: Array<() => WorkStateResult<T | null>>): WorkStateResult<T | null> {
	for (const step of steps) {
		const result = step()
		if (!result.ok) return result
		if (result.value !== null) return result
	}

	return ok(null)
}

export async function stateOrElse<T>(
	result: WorkStateResult<T | null>,
	fallback: () => WorkStateResult<T> | Promise<WorkStateResult<T>>,
): Promise<WorkStateResult<T>> {
	if (!result.ok) return result

	return result.value === null ? fallback() : ok(result.value)
}

export function stateOrElseSync<T>(result: WorkStateResult<T | null>, fallback: () => WorkStateResult<T>): WorkStateResult<T> {
	if (!result.ok) return result

	return result.value === null ? fallback() : ok(result.value)
}

export function resultValue<T>(result: Result<T, unknown>): T {
	if (!result.ok) throw new Error('Expected a successful result after checking failures.')

	return result.value
}

export function sortedActions<TAction extends Action>(actions: TAction[]): TAction[] {
	return [...actions].sort(compareActions)
}

export function latestAction<TAction extends Action>(actions: TAction[]): TAction | null {
	return sortedActions(actions).at(-1) ?? null
}

export function compareActions(left: Action, right: Action): number {
	const byTime = left.performed.at.localeCompare(right.performed.at)
	if (byTime !== 0) return byTime

	return left.id.localeCompare(right.id)
}

export function compareAcceptedThenId(left: DependencyNode, right: DependencyNode): number {
	const byAccepted = left.accepted.at.localeCompare(right.accepted.at)
	if (byAccepted !== 0) return byAccepted

	return left.id.localeCompare(right.id)
}

export function compareCreatedThenId(left: ReviewSurface, right: ReviewSurface): number {
	const byCreated = left.created.at.localeCompare(right.created.at)
	if (byCreated !== 0) return byCreated

	return left.id.localeCompare(right.id)
}

export async function blockedDependencyIds<TNode extends DependencyNode, TLink extends Link>(
	links: Link[],
	isDependencyLink: (link: Link) => link is TLink,
	loadDependency: (link: TLink) => Promise<WorkStateResult<TNode | null>>,
): Promise<WorkStateResult<Id[]>> {
	const prerequisites: TNode[] = []
	for (const link of activeLinks(links).filter(isDependencyLink)) {
		const prerequisite = await loadDependency(link)
		if (!prerequisite.ok) return prerequisite
		if (prerequisite.value !== null) prerequisites.push(prerequisite.value)
	}

	return ok(prerequisites.sort(compareAcceptedThenId).map((blocked) => blocked.id))
}

function activeLinks(links: Link[]): Link[] {
	return links.filter((link) => !isArchived(link.archivePeriods))
}

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}

export function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

function isSliceDeliveryValidationAction(action: Action): action is SliceDeliveryValidationAction {
	return action.result.type === 'validate-slice-delivery-artifact'
}

function actionResultSliceId(result: ActionResult): Id | null {
	return 'sliceId' in result ? result.sliceId : null
}

function firstReviewSurface(reviewSurfaces: ReviewSurface[]): ReviewSurface | null {
	return [...reviewSurfaces].sort(compareCreatedThenId)[0] ?? null
}

function followReviewSurfaceReplacementChain(first: ReviewSurface, byId: Map<Id, ReviewSurface>): WorkStateResult<ReviewSurface> {
	let current = first
	const seen = new Set<Id>()

	while (isReplacedReviewSurface(current)) {
		const replacement = nextReviewSurfaceReplacement(current, byId, seen)
		if (!replacement.ok) return replacement
		current = replacement.value
	}

	return ok(current)
}

function isReplacedReviewSurface(reviewSurface: ReviewSurface): reviewSurface is ReplacedReviewSurface {
	return reviewSurface.closed?.type === 'replaced'
}

function nextReviewSurfaceReplacement(
	current: ReplacedReviewSurface,
	byId: Map<Id, ReviewSurface>,
	seen: Set<Id>,
): WorkStateResult<ReviewSurface> {
	if (seen.has(current.id)) return invariant(`Review Surface replacement chain for ${current.id} has a cycle.`)
	seen.add(current.id)

	const replacement = byId.get(current.closed.reviewSurfaceId)
	return replacement === undefined
		? invariant(`Review Surface replacement ${current.closed.reviewSurfaceId} is missing.`)
		: ok(replacement)
}

function isFailureChainRootCandidate(candidate: Action, before: Action): boolean {
	return compareActions(candidate, before) < 0 && isFailureChainRoot(candidate)
}

function isFailureChainRoot(action: Action): boolean {
	return action.result.type === 'record-slice-external-operation-failure' || isFailedSliceValidation(action.result)
}

function isFailedSliceValidation(result: ActionResult): boolean {
	return isSliceValidationResult(result) && !result.evidence.passed
}

function isSliceValidationResult(
	result: ActionResult,
): result is Extract<ActionResult, { type: 'validate-slice-artifact' | 'validate-slice-delivery-artifact' }> {
	return result.type === 'validate-slice-artifact' || result.type === 'validate-slice-delivery-artifact'
}

function failureChainFromRoot(root: Action, sliceActions: Action[]): FailureChain {
	return {
		rootActionId: root.id,
		correctionRetries: sliceActions.filter(
			(action) =>
				action.result.type === 'start-slice-execution' && action.result.mode === 'correction' && compareActions(action, root) > 0,
		).length,
	}
}

function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	const latestPeriod = archivePeriods.at(-1)

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}
