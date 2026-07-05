import type { Action, DeliveryWorkOperation } from '../../domain/action'
import type { Id, RuntimeRecord } from '../../domain/commons'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { SliceWorkState } from '../../domain/slice'

export function queuedDeliveryWorkDispatchAction(input: {
	actionId: Id
	deliveryId: Id
	performed: RuntimeRecord
	operation: DeliveryWorkOperation
}): Action {
	return {
		id: input.actionId,
		deliveryId: input.deliveryId,
		performed: input.performed,
		authorized: null,
		result: { type: 'queue-delivery-work-operation', operation: input.operation },
	}
}

export function startedDeliveryWorkDispatchAction(input: {
	actionId: Id
	deliveryId: Id
	performed: RuntimeRecord
	queuedActionId: Id
	operation: DeliveryWorkOperation
}): Action {
	return {
		id: input.actionId,
		deliveryId: input.deliveryId,
		performed: input.performed,
		authorized: null,
		result: { type: 'start-delivery-work-operation', queuedActionId: input.queuedActionId, operation: input.operation },
	}
}

export function processedDeliveryWorkDispatchAction(input: {
	actionId: Id
	deliveryId: Id
	performed: RuntimeRecord
	startedActionId: Id
	operation: DeliveryWorkOperation
}): Action {
	return finishDeliveryWorkDispatchAction({ ...input, outcome: { type: 'processed' } })
}

export function staleNoopDeliveryWorkDispatchAction(input: {
	actionId: Id
	deliveryId: Id
	performed: RuntimeRecord
	startedActionId: Id
	operation: DeliveryWorkOperation
}): Action {
	return finishDeliveryWorkDispatchAction({ ...input, outcome: { type: 'stale-no-op' } })
}

function finishDeliveryWorkDispatchAction(input: {
	actionId: Id
	deliveryId: Id
	performed: RuntimeRecord
	startedActionId: Id
	operation: DeliveryWorkOperation
	outcome: Extract<Action['result'], { type: 'finish-delivery-work-operation' }>['outcome']
}): Action {
	return {
		id: input.actionId,
		deliveryId: input.deliveryId,
		performed: input.performed,
		authorized: null,
		result: {
			type: 'finish-delivery-work-operation',
			startedActionId: input.startedActionId,
			operation: input.operation,
			outcome: input.outcome,
		},
	}
}

export function deliveryOperationFromState(state: DeliveryWorkState): DeliveryWorkOperation | null {
	switch (state.type) {
		case 'needs-artifact-creation':
		case 'needs-artifact-validation':
		case 'needs-review-surface':
			return { scope: 'delivery', state: state.type }
		case 'closed':
		case 'unqueued':
		case 'operation-running':
		case 'operation-queued':
		case 'dependency-blocked':
		case 'preflight-failed':
		case 'slices-incomplete':
		case 'delivery-operation-failed':
		case 'delivery-validation-failed':
		case 'delivery-review-failed':
		case 'awaiting-review':
		case 'ready-to-ship':
			return null
		default:
			throw new Error(`Unexpected Delivery Work State: ${String(state satisfies never)}`)
	}
}

export function sliceOperationFromState(sliceId: Id, state: SliceWorkState): DeliveryWorkOperation | null {
	switch (state.type) {
		case 'needs-delivery-validation':
			return { scope: 'slice', sliceId, state: state.type, detail: { type: 'action', actionId: state.actionId } }
		case 'needs-artifact-validation':
			return { scope: 'slice', sliceId, state: state.type, detail: { type: 'artifact', artifactId: state.sliceArtifactId } }
		case 'needs-review-surface':
			return { scope: 'slice', sliceId, state: state.type, detail: { type: 'artifact', artifactId: state.sliceArtifactId } }
		case 'needs-artifact-creation':
			return { scope: 'slice', sliceId, state: state.type, detail: null }
		case 'executable':
			return state.mode === 'correction'
				? {
						scope: 'slice',
						sliceId,
						state: state.type,
						detail: { type: 'correction-root', actionId: state.failureChain.rootActionId },
					}
				: { scope: 'slice', sliceId, state: state.type, detail: null }
		case 'complete':
		case 'operation-running':
		case 'operation-queued':
		case 'dependency-blocked':
		case 'correction-blocked':
		case 'awaiting-review':
		case 'slice-operation-failed':
			return null
		default:
			throw new Error(`Unexpected Slice Work State: ${String(state satisfies never)}`)
	}
}
