import { handleDeliveryAwaitingReview } from './delivery-awaiting-review'
import { handleDeliveryNeedsArtifactValidation } from './delivery-needs-artifact-validation'
import { handleDeliveryNeedsReviewSurface } from './delivery-needs-review-surface'
import { handleDeliveryOperationFailed } from './delivery-operation-failed'
import { handleDeliveryReviewFailed } from './delivery-review-failed'
import { handleDeliverySlicesIncomplete } from './delivery-slices-incomplete'
import { handleDeliveryValidationFailed } from './delivery-validation-failed'
import { noEligibleWork } from './result'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { InvariantViolationError } from '../../../errors'
import type { CoreRuntime } from '../../../runtime'
import type { DeliveryHandlerContext, ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

type NoWorkDeliveryState = Extract<
	DeliveryWorkState,
	{ type: 'closed' | 'unqueued' | 'dependency-blocked' | 'preflight-failed' | 'needs-artifact-creation' | 'ready-to-ship' }
>

type FailedDeliveryState = Extract<
	DeliveryWorkState,
	{ type: 'delivery-operation-failed' | 'delivery-validation-failed' | 'delivery-review-failed' }
>

type ArtifactOrSliceDeliveryState = Extract<DeliveryWorkState, { type: 'slices-incomplete' | 'needs-artifact-validation' }>
type ReviewDeliveryState = Extract<DeliveryWorkState, { type: 'needs-review-surface' | 'awaiting-review' }>
type RemainingDeliveryState = ArtifactOrSliceDeliveryState | ReviewDeliveryState

const noWorkDeliveryStateTypes = new Set<DeliveryWorkState['type']>([
	'closed',
	'unqueued',
	'dependency-blocked',
	'preflight-failed',
	'needs-artifact-creation',
	'ready-to-ship',
])

const failedDeliveryStateTypes = new Set<DeliveryWorkState['type']>([
	'delivery-operation-failed',
	'delivery-validation-failed',
	'delivery-review-failed',
])

export function handleDeliveryWorkState(
	context: DeliveryHandlerContext,
	state: DeliveryWorkState,
	runtime?: CoreRuntime,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const resolved = resolvedContextForState(context, state)
	if (!resolved.ok) return resolved
	if (isNoWorkDeliveryState(state)) return noEligibleWork()
	if (isFailedDeliveryState(state)) return handleFailedDeliveryWorkState(state)

	return handleRemainingDeliveryWorkState(resolved.value, state, runtime)
}

type DeliveryHandlerContextResolution =
	| { ok: true; value: DeliveryHandlerContext | ResolvedDeliveryHandlerContext }
	| { ok: false; error: InvariantViolationError }

function resolvedContextForState(context: DeliveryHandlerContext, state: DeliveryWorkState): DeliveryHandlerContextResolution {
	return requiresDeliveryWorkResolution(state) && !('workResolution' in context)
		? {
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Delivery Work Resolution is required for scheduler-actionable Delivery work.',
				},
			}
		: { ok: true, value: context }
}

function requiresDeliveryWorkResolution(state: DeliveryWorkState): boolean {
	return !['closed', 'unqueued', 'dependency-blocked', 'preflight-failed', 'ready-to-ship'].includes(state.type)
}

function handleFailedDeliveryWorkState(state: FailedDeliveryState): RunDeliveryWorkHandlerResult {
	switch (state.type) {
		case 'delivery-operation-failed':
			return handleDeliveryOperationFailed()
		case 'delivery-validation-failed':
			return handleDeliveryValidationFailed()
		case 'delivery-review-failed':
			return handleDeliveryReviewFailed()
		default: {
			const exhaustive = state satisfies never
			return exhaustive
		}
	}
}

function handleRemainingDeliveryWorkState(
	context: DeliveryHandlerContext | ResolvedDeliveryHandlerContext,
	state: RemainingDeliveryState,
	runtime: CoreRuntime | undefined,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return isArtifactOrSliceDeliveryState(state)
		? handleArtifactOrSliceDeliveryWorkState(context, state, runtime)
		: handleReviewDeliveryWorkState(state)
}

function handleArtifactOrSliceDeliveryWorkState(
	context: DeliveryHandlerContext | ResolvedDeliveryHandlerContext,
	state: ArtifactOrSliceDeliveryState,
	runtime: CoreRuntime | undefined,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	switch (state.type) {
		case 'slices-incomplete':
			return handleDeliverySlicesIncompleteState(context, runtime)
		case 'needs-artifact-validation':
			return handleDeliveryNeedsArtifactValidation(context, state)
		default: {
			const exhaustive = state satisfies never
			return exhaustive
		}
	}
}

function handleReviewDeliveryWorkState(state: ReviewDeliveryState): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	switch (state.type) {
		case 'needs-review-surface':
			return handleDeliveryNeedsReviewSurface()
		case 'awaiting-review':
			return handleDeliveryAwaitingReview(state)
		default: {
			const exhaustive = state satisfies never
			return exhaustive
		}
	}
}

function handleDeliverySlicesIncompleteState(
	context: DeliveryHandlerContext | ResolvedDeliveryHandlerContext,
	runtime: CoreRuntime | undefined,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return runtime === undefined
		? missingDeliveryWorkRuntime()
		: handleDeliverySlicesIncomplete(runtime, context as ResolvedDeliveryHandlerContext)
}

function isNoWorkDeliveryState(state: DeliveryWorkState): state is NoWorkDeliveryState {
	return noWorkDeliveryStateTypes.has(state.type)
}

function isArtifactOrSliceDeliveryState(state: RemainingDeliveryState): state is ArtifactOrSliceDeliveryState {
	return state.type === 'slices-incomplete' || state.type === 'needs-artifact-validation'
}

function isFailedDeliveryState(state: DeliveryWorkState): state is FailedDeliveryState {
	return failedDeliveryStateTypes.has(state.type)
}

function missingDeliveryWorkRuntime(): RunDeliveryWorkHandlerResult {
	return {
		ok: false,
		error: {
			type: 'invariant-violation',
			message: 'Core Runtime is required for scheduler-actionable Slice work.',
		},
	}
}
