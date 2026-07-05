import { noEligibleWork } from './result'
import { handleSliceAwaitingReview } from './slice-awaiting-review'
import { handleSliceExecutable } from './slice-executable'
import { handleSliceNeedsArtifactValidation } from './slice-needs-artifact-validation'
import { handleSliceNeedsDeliveryValidation } from './slice-needs-delivery-validation'
import { handleSliceOperationFailed } from './slice-operation-failed'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, DeliveryWorkResolution, DeliveryWorkHandlerResult } from '../../delivery-work/types'

type NoWorkSliceState = Extract<
	SliceWorkState,
	{
		type:
			| 'complete'
			| 'operation-running'
			| 'operation-queued'
			| 'dependency-blocked'
			| 'correction-blocked'
			| 'needs-artifact-creation'
	}
>

type ValidationSliceState = Extract<SliceWorkState, { type: 'needs-delivery-validation' | 'needs-artifact-validation' }>
type ProviderBackedSliceState = Extract<SliceWorkState, { type: 'needs-review-surface' }>

type RemainingSliceState = Exclude<SliceWorkState, NoWorkSliceState | ValidationSliceState | ProviderBackedSliceState>

const noWorkSliceStateTypes = new Set<SliceWorkState['type']>([
	'complete',
	'operation-running',
	'operation-queued',
	'dependency-blocked',
	'correction-blocked',
	'needs-artifact-creation',
])

const validationSliceStateTypes = new Set<SliceWorkState['type']>(['needs-delivery-validation', 'needs-artifact-validation'])

export function handleSliceWorkState(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: SliceWorkState,
	resolution: DeliveryWorkResolution,
): Promise<DeliveryWorkHandlerResult> | DeliveryWorkHandlerResult {
	if (isNoWorkSliceState(state)) return noEligibleWork()
	if (isValidationSliceState(state)) return handleSliceValidationWorkState(context, slice, state)
	if (isProviderBackedSliceState(state)) return providerBackedSliceStateInvariant()

	return handleRemainingSliceWorkState(context, slice, state, resolution)
}

function handleSliceValidationWorkState(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: ValidationSliceState,
): Promise<DeliveryWorkHandlerResult> {
	switch (state.type) {
		case 'needs-delivery-validation':
			return handleSliceNeedsDeliveryValidation(context, slice, state)
		case 'needs-artifact-validation':
			return handleSliceNeedsArtifactValidation(context, slice, state)
		default:
			throw new Error(`Unexpected validation Slice Work State: ${String(state satisfies never)}`)
	}
}

function handleRemainingSliceWorkState(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: RemainingSliceState,
	resolution: DeliveryWorkResolution,
): Promise<DeliveryWorkHandlerResult> | DeliveryWorkHandlerResult {
	switch (state.type) {
		case 'awaiting-review':
			return handleSliceAwaitingReview(slice, state)
		case 'slice-operation-failed':
			return handleSliceOperationFailed()
		case 'executable':
			return handleSliceExecutable(context, slice, state, resolution)
		default:
			throw new Error(`Unexpected remaining Slice Work State: ${String(state satisfies never)}`)
	}
}

function isNoWorkSliceState(state: SliceWorkState): state is NoWorkSliceState {
	return noWorkSliceStateTypes.has(state.type)
}

function isValidationSliceState(state: SliceWorkState): state is ValidationSliceState {
	return validationSliceStateTypes.has(state.type)
}

function isProviderBackedSliceState(state: SliceWorkState): state is ProviderBackedSliceState {
	return state.type === 'needs-review-surface'
}

function providerBackedSliceStateInvariant(): DeliveryWorkHandlerResult {
	return {
		ok: false,
		error: {
			type: 'invariant-violation',
			message: 'Provider-backed Slice work must be handled outside the transactional Slice Work State dispatcher.',
		},
	}
}
