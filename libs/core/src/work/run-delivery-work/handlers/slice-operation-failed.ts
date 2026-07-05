import { notImplemented } from './result'
import type { ScheduleDeliveryWorkHandlerResult } from '../types'

export function handleSliceOperationFailed(): ScheduleDeliveryWorkHandlerResult {
	return notImplemented('scheduleDeliveryWork.slice.slice-operation-failed')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceOperationFailed', () => {
		it('is a Slice external-operation failure recovery stub', () => {
			expect(handleSliceOperationFailed()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'scheduleDeliveryWork.slice.slice-operation-failed' },
			})
		})
	})
}
