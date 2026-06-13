import type { Action } from '../../../domain/action'
import type { ExternalOperationEvidence } from '../../../domain/evidence'
import { nextId, runtimeRecord } from '../../../utils/command-storage'
import type { Result as CoreResult } from '../../../utils/types'
import type { ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

export function actionRecord(
	context: ResolvedDeliveryHandlerContext,
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

export function externalOperationEvidence(summary: string): ExternalOperationEvidence {
	return { type: 'external-operation', operation: { type: 'create-artifact' }, passed: false, summary }
}

export function noObservedArtifactCreationWrite(): RunDeliveryWorkHandlerResult {
	return { ok: true, value: { processedCount: 0, failures: [] } }
}
