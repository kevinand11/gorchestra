import { notImplemented } from './result'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleDeliveryReviewFailed(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.delivery.delivery-review-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryReviewFailed', () => {
		it('is a Delivery Review Surface failure recovery stub', () => {
			expect(handleDeliveryReviewFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery.delivery-review-failed' },
			})
		})
	})
}
