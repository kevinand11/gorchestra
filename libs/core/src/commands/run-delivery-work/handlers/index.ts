import { handleDeliveryAwaitingReview } from './delivery-awaiting-review'
import { handleDeliveryNeedsArtifactCreation } from './delivery-needs-artifact-creation'
import { handleDeliveryNeedsArtifactValidation } from './delivery-needs-artifact-validation'
import { handleDeliveryNeedsReviewSurface } from './delivery-needs-review-surface'
import { handleDeliveryOperationFailed } from './delivery-operation-failed'
import { handleDeliveryReviewFailed } from './delivery-review-failed'
import { handleDeliverySlicesIncomplete } from './delivery-slices-incomplete'
import { handleDeliveryValidationFailed } from './delivery-validation-failed'
import { noEligibleWork } from './result'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

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
	'needs-artifact-creation': () => handleDeliveryNeedsArtifactCreation(),
	'slices-incomplete': (context) => handleDeliverySlicesIncomplete(context),
	'delivery-operation-failed': () => handleDeliveryOperationFailed(),
	'delivery-validation-failed': () => handleDeliveryValidationFailed(),
	'delivery-review-failed': () => handleDeliveryReviewFailed(),
	'needs-artifact-validation': () => handleDeliveryNeedsArtifactValidation(),
	'needs-review-surface': () => handleDeliveryNeedsReviewSurface(),
	'awaiting-review': (_context, state) => handleDeliveryAwaitingReview(state),
	'ready-to-ship': noEligibleWork,
}

export function handleDeliveryWorkState(
	context: DeliveryHandlerContext,
	state: DeliveryWorkState,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return deliveryHandlers[state.type](context, state as never)
}
