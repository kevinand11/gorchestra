import { notImplemented } from './result'
import type { RunDeliveryWorkHandlerResult } from '../types'

export function handleDeliveryNeedsArtifactCreation(): RunDeliveryWorkHandlerResult {
	return notImplemented('runDeliveryWork.delivery.needs-artifact-creation')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('handleDeliveryNeedsArtifactCreation', () => {
		it('is a provider-backed artifact creation stub', () => {
			expect(handleDeliveryNeedsArtifactCreation()).toEqual({
				ok: false,
				error: { type: 'not-implemented', operation: 'runDeliveryWork.delivery.needs-artifact-creation' },
			})
		})
	})
}
