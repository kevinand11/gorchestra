import { workedActions } from './result'
import type { Action } from '../../../domain/action'
import type { ValidationEvidence, ValidationOperation } from '../../../domain/evidence'
import { createRecord, nextId, runtimeRecord } from '../../utils/storage'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

export function noConfiguredValidationEvidence(operation: ValidationOperation['type'], summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed: true, summary }
}

export async function writeValidationAction(
	context: DeliveryHandlerContext,
	result: Action['result'],
): Promise<RunDeliveryWorkHandlerResult> {
	const id = nextId(context.values, 'action')
	if (!id.ok) return id

	const performed = runtimeRecord(context.values)
	if (!performed.ok) return performed

	const action: Action = {
		id: id.value,
		deliveryId: context.deliveryContext.delivery.id,
		performed: performed.value,
		authorized: null,
		result,
	}

	const put = await createRecord('action', context.storage, action)
	if (!put.ok) return put

	return workedActions([action.id])
}
