import type { Action } from '../../../domain/action'
import type { Id } from '../../../domain/commons'
import type { ExternalOperation, ExternalOperationEvidence } from '../../../domain/evidence'
import type { Result as CoreResult } from '../../../utils/types'
import { nextId, runtimeRecord } from '../../utils/storage'
import type { RunDeliveryWorkNoObservedChangeTarget } from '../index'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

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
	return { ok: true, value: { processedCount, failures: [] } }
}

export function notImplemented(operation: string): RunDeliveryWorkHandlerResult {
	return { ok: false, error: { type: 'not-implemented', operation } }
}

export function actionRecord(
	context: DeliveryHandlerContext,
	result: Action['result'],
): CoreResult<Action, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
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
