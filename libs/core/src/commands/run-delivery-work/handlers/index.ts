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
import type { DeliveryHandlerContext, ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

type DeliveryStateHandler<TState extends DeliveryWorkState> = (
	context: DeliveryHandlerContext,
	state: TState,
) => Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult

type DeliveryHandlerMap = {
	[TState in DeliveryWorkState as TState['type']]: DeliveryStateHandler<TState>
}

const deliveryHandlers: DeliveryHandlerMap = {
	closed: noEligibleWork,
	unqueued: noEligibleWork,
	'dependency-blocked': noEligibleWork,
	'preflight-failed': noEligibleWork,
	'needs-artifact-creation': noEligibleWork,
	'slices-incomplete': (context) => handleDeliverySlicesIncomplete(context as ResolvedDeliveryHandlerContext),
	'delivery-operation-failed': () => handleDeliveryOperationFailed(),
	'delivery-validation-failed': () => handleDeliveryValidationFailed(),
	'delivery-review-failed': () => handleDeliveryReviewFailed(),
	'needs-artifact-validation': (context, state) => handleDeliveryNeedsArtifactValidation(context, state),
	'needs-review-surface': () => handleDeliveryNeedsReviewSurface(),
	'awaiting-review': (_context, state) => handleDeliveryAwaitingReview(state),
	'ready-to-ship': noEligibleWork,
}

export function handleDeliveryWorkState(
	context: DeliveryHandlerContext,
	state: DeliveryWorkState,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const resolved = resolvedContextForState(context, state)
	if (!resolved.ok) return resolved

	return deliveryHandlers[state.type](resolved.value, state as never)
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
