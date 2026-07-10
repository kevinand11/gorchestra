import { actionRecord, workedActions } from './result'
import type { Action } from '../../../domain/action'
import type { ValidationEvidence, ValidationOperation } from '../../../domain/evidence'
import { createRecord } from '../../../utils/storage/helpers'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function noConfiguredValidationEvidence(operation: ValidationOperation['type'], summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed: true, summary }
}

export async function writeValidationAction(context: DeliveryHandlerContext, result: Action['result']): Promise<DeliveryWorkHandlerResult> {
	const action = actionRecord(context, result)
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	if (!put.ok) return put

	return workedActions([action.value.id])
}
