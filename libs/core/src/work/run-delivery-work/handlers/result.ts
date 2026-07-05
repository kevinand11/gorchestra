import type { Action } from '../../../domain/action'
import type { Id } from '../../../domain/commons'
import type { ExternalOperation, ExternalOperationEvidence } from '../../../domain/evidence'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { ScheduleDeliveryWorkNoObservedChangeTarget } from '../index'
import type { DeliveryHandlerContext, ScheduleDeliveryWorkHandlerResult } from '../types'

export function noEligibleWork(): ScheduleDeliveryWorkHandlerResult {
	return completed()
}

export function noObservedChange(_observed: ScheduleDeliveryWorkNoObservedChangeTarget): ScheduleDeliveryWorkHandlerResult {
	return completed()
}

export function sliceCapacityFull(_activeSlots: number, _maxProcessableSliceSlots: number): ScheduleDeliveryWorkHandlerResult {
	return completed()
}

export function worked(_actionId: Id, _agentRunId: Id): ScheduleDeliveryWorkHandlerResult {
	return completed(1)
}

export function workedActions(actionIds: Id[]): ScheduleDeliveryWorkHandlerResult {
	return completed(actionIds.length)
}

export function completed(processedCount = 0): ScheduleDeliveryWorkHandlerResult {
	return { ok: true, value: { processedCount, failures: [] } }
}

export function notImplemented(operation: string): ScheduleDeliveryWorkHandlerResult {
	return { ok: false, error: { type: 'not-implemented', operation } }
}

export function actionRecord(
	context: DeliveryHandlerContext,
	result: Action['result'],
): CoreResult<Action, ScheduleDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.values, 'action')
	if (!id.ok) return id

	const performed = runtimeRecord(context.values)
	if (!performed.ok) return performed

	return {
		ok: true,
		value: {
			id: id.value,
			deliveryId: context.deliveryContext.delivery.id,
			performed: performed.value,
			authorized: null,
			result,
		},
	}
}

export function externalOperationEvidence(
	summary: string,
	operation: ExternalOperation['type'] = 'create-artifact',
	passed = false,
): ExternalOperationEvidence {
	return { type: 'external-operation', operation: { type: operation }, passed, summary }
}
