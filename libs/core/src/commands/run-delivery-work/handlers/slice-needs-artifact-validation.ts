import type { RunDeliveryWorkHandlerResult } from '../types'
import { notImplemented } from './result'

export function handleSliceNeedsArtifactValidation(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.slice.needs-artifact-validation')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleSliceNeedsArtifactValidation', () => {
		it('is a Slice Artifact validation stub', () => {
			expect(handleSliceNeedsArtifactValidation()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.slice.needs-artifact-validation' },
			})
		})
	})
}
