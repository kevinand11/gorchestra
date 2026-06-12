import { invariant, ok } from './result'
import type { ReplacedReviewSurface, WorkStateResult } from './types'
import type { Id } from '../../../domain/commons'
import type { ReviewSurface } from '../../../domain/review-surface'

export function currentScopedReviewSurface(reviewSurfaces: ReviewSurface[]): WorkStateResult<ReviewSurface | null> {
	const first = firstReviewSurface(reviewSurfaces)
	if (first === null) return ok(null)

	return followReviewSurfaceReplacementChain(first, new Map(reviewSurfaces.map((reviewSurface) => [reviewSurface.id, reviewSurface])))
}

export function compareCreatedThenId(left: ReviewSurface, right: ReviewSurface): number {
	const byCreated = left.created.at.localeCompare(right.created.at)
	if (byCreated !== 0) return byCreated

	return left.id.localeCompare(right.id)
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
