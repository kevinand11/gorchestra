import type { RunDeliveryWorkHandlerResult } from '../types'
import { notImplemented } from './result'

export function handleDeliveryNeedsReviewSurface(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.delivery.needs-review-surface')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryNeedsReviewSurface', () => {
		it('is a Delivery Review Surface creation stub', () => {
			expect(handleDeliveryNeedsReviewSurface()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery.needs-review-surface' },
			})
		})
	})
}
