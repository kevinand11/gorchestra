import { notImplemented } from './result'
import type { DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleDeliveryOperationFailed(): DeliveryWorkHandlerResult {
	return notImplemented('scheduleDeliveryWork.delivery.delivery-operation-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryOperationFailed', () => {
		it('is a Delivery external-operation failure recovery stub', () => {
			expect(handleDeliveryOperationFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'scheduleDeliveryWork.delivery.delivery-operation-failed' },
			})
		})
	})
}
