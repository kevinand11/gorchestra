import { noObservedChange } from './result'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleSliceAwaitingReview(
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'awaiting-review' }>,
): DeliveryWorkHandlerResult {
	return noObservedChange({ type: 'slice-review-surface', sliceId: slice.id, reviewSurfaceId: state.reviewSurfaceId })
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceAwaitingReview', () => {
		it('reports no observed Slice Review Surface change', () => {
			expect(
				handleSliceAwaitingReview(
					{
						id: '01k00000000000000000000042',
						deliveryId: '01k00000000000000000000008',
						order: 0,
						title: 'Slice',
						instruction: { body: 'Do work.' },
						accepted: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
					},
					{ type: 'awaiting-review', reviewSurfaceId: '01k00000000000000000000036' },
				),
			).toEqual({ ok: true, value: { processedCount: 0, failures: [] } })
		})
	})
}
