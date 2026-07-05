import { handleDeliveryAwaitingReview } from './delivery-awaiting-review'
import { handleDeliveryNeedsArtifactValidation } from './delivery-needs-artifact-validation'
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
	{
		type:
			| 'closed'
			| 'unqueued'
			| 'operation-running'
			| 'operation-queued'
			| 'dependency-blocked'
			| 'preflight-failed'
			| 'needs-artifact-creation'
			| 'ready-to-ship'
	}
>

type FailedDeliveryState = Extract<
	DeliveryWorkState,
	{ type: 'delivery-operation-failed' | 'delivery-validation-failed' | 'delivery-review-failed' }
>

type ArtifactOrSliceDeliveryState = Extract<DeliveryWorkState, { type: 'slices-incomplete' | 'needs-artifact-validation' }>
type ProviderBackedDeliveryState = Extract<DeliveryWorkState, { type: 'needs-review-surface' }>
type ReviewDeliveryState = Extract<DeliveryWorkState, { type: 'needs-review-surface' | 'awaiting-review' }>
type RemainingDeliveryState = ArtifactOrSliceDeliveryState | ReviewDeliveryState

const noWorkDeliveryStateTypes = new Set<DeliveryWorkState['type']>([
	'closed',
	'unqueued',
	'operation-running',
	'operation-queued',
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
	return resolved.ok ? handleResolvedDeliveryWorkState(resolved.value, state, runtime) : resolved
}

function handleResolvedDeliveryWorkState(
	context: DeliveryHandlerContext | ResolvedDeliveryHandlerContext,
	state: DeliveryWorkState,
	runtime: CoreRuntime | undefined,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	if (isNoWorkDeliveryState(state)) return noEligibleWork()
	if (isFailedDeliveryState(state)) return handleFailedDeliveryWorkState(state)
	if (isProviderBackedDeliveryState(state)) return providerBackedDeliveryStateInvariant()

	return handleRemainingDeliveryWorkState(context, state, runtime)
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
	return ![
		'closed',
		'unqueued',
		'operation-running',
		'operation-queued',
		'dependency-blocked',
		'preflight-failed',
		'ready-to-ship',
	].includes(state.type)
}

function handleFailedDeliveryWorkState(state: FailedDeliveryState): RunDeliveryWorkHandlerResult {
	switch (state.type) {
		case 'delivery-operation-failed':
			return handleDeliveryOperationFailed()
		case 'delivery-validation-failed':
			return handleDeliveryValidationFailed()
		case 'delivery-review-failed':
			return handleDeliveryReviewFailed()
		default:
			throw new Error(`Unexpected failed Delivery Work State: ${String(state satisfies never)}`)
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
		default:
			throw new Error(`Unexpected artifact/slice Delivery Work State: ${String(state satisfies never)}`)
	}
}

function handleReviewDeliveryWorkState(state: ReviewDeliveryState): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	switch (state.type) {
		case 'needs-review-surface':
			return providerBackedDeliveryStateInvariant()
		case 'awaiting-review':
			return handleDeliveryAwaitingReview(state)
		default:
			throw new Error(`Unexpected review Delivery Work State: ${String(state satisfies never)}`)
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

function isProviderBackedDeliveryState(state: DeliveryWorkState): state is ProviderBackedDeliveryState {
	return state.type === 'needs-review-surface'
}

function providerBackedDeliveryStateInvariant(): RunDeliveryWorkHandlerResult {
	return {
		ok: false,
		error: {
			type: 'invariant-violation',
			message: 'Provider-backed Delivery work must be handled outside the transactional Delivery Work State dispatcher.',
		},
	}
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
