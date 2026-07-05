import { notImplemented } from './result'
import type { DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleDeliveryReviewFailed(): DeliveryWorkHandlerResult {
	return notImplemented('scheduleDeliveryWork.delivery.delivery-review-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryReviewFailed', () => {
		it('is a Delivery Review Surface failure recovery stub', () => {
			expect(handleDeliveryReviewFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'scheduleDeliveryWork.delivery.delivery-review-failed' },
			})
		})
	})
}
