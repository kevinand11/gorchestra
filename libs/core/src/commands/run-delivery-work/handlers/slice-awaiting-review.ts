import { noObservedChange } from './result'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleSliceAwaitingReview(
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'awaiting-review' }>,
): RunDeliveryWorkHandlerResult {
	return noObservedChange({ type: 'slice-review-surface', sliceId: slice.id, reviewSurfaceId: state.reviewSurfaceId })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceAwaitingReview', () => {
		it('reports no observed Slice Review Surface change', () => {
			expect(
				handleSliceAwaitingReview(
					{
						id: 'slice-1',
						deliveryId: 'delivery-1',
						order: 0,
						title: 'Slice',
						instruction: { body: 'Do work.' },
						accepted: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
					},
					{ type: 'awaiting-review', reviewSurfaceId: 'review-1' },
				),
			).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
		})
	})
}
