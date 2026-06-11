import type { Delivery } from '../../../domain/delivery'
import type { CoreStorageTransaction } from '../../../services'
import { preflightDeliveryWork, type FailedDeliveryPreflight } from '../../../utils/delivery-preflight'
import type { Result } from '../../../utils/types'
import type { DeliveryWorkResolution, RunDeliveryWorkResolutionError } from '../types'

export async function resolveDeliveryWork(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<DeliveryWorkResolution, RunDeliveryWorkResolutionError>> {
	const preflight = await preflightDeliveryWork(tx, delivery)
	if (!preflight.ok) return preflight

	return preflight.value.type === 'passed'
		? { ok: true, value: { modelId: preflight.value.modelId, workConfig: preflight.value.workConfig } }
		: failedPreflightForRunDeliveryWork(preflight.value)
}

function failedPreflightForRunDeliveryWork(failure: FailedDeliveryPreflight): Result<never, RunDeliveryWorkResolutionError> {
	if (failure.reason.type === 'work-config-unresolved') {
		return { ok: false, error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery-work-config-unresolved' } }
	}

	return { ok: false, error: failure.reason.error }
}
