import { notImplemented } from './result'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleSliceNeedsArtifactCreation(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.slice.needs-artifact-creation')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceNeedsArtifactCreation', () => {
		it('is a provider-backed artifact creation stub', () => {
			expect(handleSliceNeedsArtifactCreation()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.slice.needs-artifact-creation' },
			})
		})
	})
}
