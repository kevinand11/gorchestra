import type { RunDeliveryWorkHandlerResult } from '../types'
import { notImplemented } from './result'

export function handleSliceOperationFailed(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.slice.slice-operation-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceOperationFailed', () => {
		it('is a Slice external-operation failure recovery stub', () => {
			expect(handleSliceOperationFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.slice.slice-operation-failed' },
			})
		})
	})
}
