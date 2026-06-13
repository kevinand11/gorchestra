import type { Action } from '../../../domain/action'
import type { ValidationEvidence, ValidationOperation } from '../../../domain/evidence'
import { nextId, putRecord, runtimeRecord } from '../../../utils/command-storage'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { workedActions } from './result'

export function noConfiguredValidationEvidence(operation: ValidationOperation['type'], summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed: true, summary }
}

export async function writeValidationAction(
	context: DeliveryHandlerContext,
	result: Action['result'],
): Promise<RunDeliveryWorkHandlerResult> {
	const id = nextId(context.services, 'action')
	if (!id.ok) return id

	const performed = runtimeRecord(context.services)
	if (!performed.ok) return performed

	const action: Action = {
		id: id.value,
		deliveryId: context.deliveryContext.delivery.id,
		performed: performed.value,
		authorized: null,
		result,
	}

	const put = await putRecord('action', context.tx.actions, action.id, action)
	if (!put.ok) return put

	return workedActions([action.id])
}
