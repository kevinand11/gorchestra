import type { RunDeliveryWorkHandlerResult } from '../types'
import { notImplemented } from './result'

export function handleSliceNeedsDeliveryValidation(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.slice.needs-delivery-validation')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceNeedsDeliveryValidation', () => {
		it('is a Slice Delivery Artifact validation stub', () => {
			expect(handleSliceNeedsDeliveryValidation()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.slice.needs-delivery-validation' },
			})
		})
	})
}
