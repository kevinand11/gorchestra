import type { Id } from '../../../domain/commons'
import type { RunDeliveryWorkNoObservedChangeTarget } from '../index'
import type { Result, RunDeliveryWorkHandlerResult } from '../types'

export function noEligibleWork(): RunDeliveryWorkHandlerResult {
	return completed()
}

export function noObservedChange(_observed: RunDeliveryWorkNoObservedChangeTarget): RunDeliveryWorkHandlerResult {
	return completed()
}

export function sliceCapacityFull(_activeSlots: number, _maxProcessableSliceSlots: number): RunDeliveryWorkHandlerResult {
	return completed()
}

export function worked(_actionId: Id, _agentRunId: Id): RunDeliveryWorkHandlerResult {
	return completed(1)
}

export function workedActions(actionIds: Id[]): RunDeliveryWorkHandlerResult {
	return completed(actionIds.length)
}

export function completed(processedCount = 0): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { processedCount, failures: [] } satisfies Result }
}

export function notImplemented(operation: string): RunDeliveryWorkHandlerResult {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
