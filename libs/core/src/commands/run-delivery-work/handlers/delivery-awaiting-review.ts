import type { DeliveryWorkState } from '../../../domain/delivery'
import type { RunDeliveryWorkHandlerResult } from '../types'
import { noObservedChange } from './result'

export function handleDeliveryAwaitingReview(state: Extract<DeliveryWorkState, { type: 'awaiting-review' }>): RunDeliveryWorkHandlerResult {
	return noObservedChange({ type: 'delivery-review-surface', reviewSurfaceId: state.reviewSurfaceId })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryAwaitingReview', () => {
		it('reports no observed Delivery Review Surface change', () => {
			expect(handleDeliveryAwaitingReview({ type: 'awaiting-review', reviewSurfaceId: 'review-1' })).toEqual({
				ok: true,
				value: {
					type: 'no-op',
					reason: { type: 'no-observed-change', observed: { type: 'delivery-review-surface', reviewSurfaceId: 'review-1' } },
				},
			})
		})
	})
}
