import { noEligibleWork } from './result'
import { handleSliceAwaitingReview } from './slice-awaiting-review'
import { handleSliceExecutable } from './slice-executable'
import { handleSliceNeedsArtifactCreation } from './slice-needs-artifact-creation'
import { handleSliceNeedsArtifactValidation } from './slice-needs-artifact-validation'
import { handleSliceNeedsDeliveryValidation } from './slice-needs-delivery-validation'
import { handleSliceOperationFailed } from './slice-operation-failed'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, DeliveryWorkResolution, RunDeliveryWorkHandlerResult } from '../types'

type SliceStateHandler<TState extends SliceWorkState> = (
	context: DeliveryHandlerContext,
	slice: Slice,
	state: TState,
	resolution: DeliveryWorkResolution,
) => Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult

type SliceHandlerMap = {
	[TState in SliceWorkState as TState['type']]: SliceStateHandler<TState>
}

const sliceHandlers: SliceHandlerMap = {
	complete: noEligibleWork,
	'needs-delivery-validation': () => handleSliceNeedsDeliveryValidation(),
	'dependency-blocked': noEligibleWork,
	'needs-artifact-validation': () => handleSliceNeedsArtifactValidation(),
	'correction-blocked': noEligibleWork,
	'awaiting-review': (_context, slice, state) => handleSliceAwaitingReview(slice, state),
	'slice-operation-failed': () => handleSliceOperationFailed(),
	'needs-artifact-creation': () => handleSliceNeedsArtifactCreation(),
	executable: (context, slice, state, resolution) => handleSliceExecutable(context, slice, state, resolution),
}

export function handleSliceWorkState(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: SliceWorkState,
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return sliceHandlers[state.type](context, slice, state as never, resolution)
}

export function isActiveSliceSlotState(state: SliceWorkState): boolean {
	return state.type === 'needs-artifact-validation' || state.type === 'needs-delivery-validation'
}
