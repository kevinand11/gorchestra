import type { Id } from '../../domain/commons'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { DeliveryWorkOperation } from '../../domain/delivery-work-operation'
import type { SliceWorkState } from '../../domain/slice'

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
		case 'delivery-dispatch-failed':
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
		case 'slice-dispatch-failed':
		case 'dependency-blocked':
		case 'correction-blocked':
		case 'awaiting-review':
		case 'slice-operation-failed':
			return null
		default:
			throw new Error(`Unexpected Slice Work State: ${String(state satisfies never)}`)
	}
}
