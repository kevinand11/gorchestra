import type { Action } from '../../../domain/action'
import type { ValidationEvidence, ValidationOperation } from '../../../domain/evidence'
import { nextId, putRecord, runtimeRecord } from '../../../utils/command-storage'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { workedActions } from './result'

export function noConfiguredValidationEvidence(operation: ValidationOperation['type'], summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed: true, summary }
}

export async function writeValidationAction(
	context: DeliveryHandlerContext,
	result: Action['result'],
): Promise<RunDeliveryWorkHandlerResult> {
	const action = validationActionRecord(context, result)
	if (!action.ok) return action

	const put = await putRecord('action', context.tx.actions, action.value.id, action.value)
	if (!put.ok) return put

	return workedActions([action.value.id])
}

export function noObservedArtifactValidationWrite(): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { processedCount: 0, failures: [] } }
}

function validationActionRecord(
	context: DeliveryHandlerContext,
	result: Action['result'],
): CoreResult<Action, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.services, 'action')
	if (!id.ok) return id

	const performed = runtimeRecord(context.services)
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
