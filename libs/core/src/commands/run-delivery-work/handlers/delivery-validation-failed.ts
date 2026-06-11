import { notImplemented } from './result'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleDeliveryValidationFailed(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.delivery.delivery-validation-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryValidationFailed', () => {
		it('is a Delivery validation failure recovery stub', () => {
			expect(handleDeliveryValidationFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery.delivery-validation-failed' },
			})
		})
	})
}
