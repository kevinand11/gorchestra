import { noObservedChange } from './result'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleDeliveryAwaitingReview(state: Extract<DeliveryWorkState, { type: 'awaiting-review' }>): DeliveryWorkHandlerResult {
	return noObservedChange({ type: 'delivery-review-surface', reviewSurfaceId: state.reviewSurfaceId })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryAwaitingReview', () => {
		it('reports no observed Delivery Review Surface change', () => {
			expect(handleDeliveryAwaitingReview({ type: 'awaiting-review', reviewSurfaceId: 'review-1' })).toEqual({
				ok: true,
				value: { processedCount: 0, failures: [] },
			})
		})
	})
}
