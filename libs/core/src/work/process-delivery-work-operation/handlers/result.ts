import type { Action } from '../../../domain/action'
import type { Id } from '../../../domain/commons'
import type { ExternalOperation, ExternalOperationEvidence } from '../../../domain/evidence'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryWorkNoObservedChangeTarget } from '../../delivery-work/types'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function noEligibleWork(): DeliveryWorkHandlerResult {
	return completed()
}

export function noObservedChange(_observed: DeliveryWorkNoObservedChangeTarget): DeliveryWorkHandlerResult {
	return completed()
}

export function workedActions(actionIds: Id[]): DeliveryWorkHandlerResult {
	return completed(actionIds.length)
}

export function completed(processedCount = 0): DeliveryWorkHandlerResult {
	return { ok: true, value: { processedCount, failures: [] } }
}

export function notImplemented(operation: string): DeliveryWorkHandlerResult {
	return { ok: false, error: { type: 'not-implemented', operation } }
}

export function actionRecord(
	context: DeliveryHandlerContext,
	result: Action['result'],
): CoreResult<Action, DeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.values)
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
