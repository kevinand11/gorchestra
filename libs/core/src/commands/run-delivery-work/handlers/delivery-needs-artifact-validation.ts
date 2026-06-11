import { notImplemented } from './result'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleDeliveryNeedsArtifactValidation(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.delivery.needs-artifact-validation')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryNeedsArtifactValidation', () => {
		it('is a Delivery Artifact validation stub', () => {
			expect(handleDeliveryNeedsArtifactValidation()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery.needs-artifact-validation' },
			})
		})
	})
}
