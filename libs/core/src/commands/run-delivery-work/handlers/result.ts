import type { Id } from '../../../domain/commons'
import type { Result, RunDeliveryWorkNoObservedChangeTarget } from '../index'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function noEligibleWork(): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { type: 'no-op', reason: { type: 'no-eligible-work' } } }
}

export function noObservedChange(observed: RunDeliveryWorkNoObservedChangeTarget): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { type: 'no-op', reason: { type: 'no-observed-change', observed } } }
}

export function sliceCapacityFull(activeSlots: number, maxActiveSliceSlots: number): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { type: 'no-op', reason: { type: 'slice-capacity-full', activeSlots, maxActiveSliceSlots } } }
}

export function worked(actionId: Id, agentRunId: Id): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { type: 'worked', actionIds: [actionId], agentRunIds: [agentRunId] } satisfies Result }
}

export function workedActions(actionIds: Id[]): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { type: 'worked', actionIds, agentRunIds: [] } satisfies Result }
}

export function notImplemented(operation: string): RunDeliveryWorkHandlerResult {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
