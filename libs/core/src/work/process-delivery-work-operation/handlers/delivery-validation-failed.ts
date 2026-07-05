import { notImplemented } from './result'
import type { DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleDeliveryValidationFailed(): DeliveryWorkHandlerResult {
	return notImplemented('scheduleDeliveryWork.delivery.delivery-validation-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryValidationFailed', () => {
		it('is a Delivery validation failure recovery stub', () => {
			expect(handleDeliveryValidationFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'scheduleDeliveryWork.delivery.delivery-validation-failed' },
			})
		})
	})
}
