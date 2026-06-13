import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { noConfiguredValidationEvidence, writeValidationAction } from './artifact-validation-recording'

export function handleSliceNeedsArtifactValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	_state: Extract<SliceWorkState, { type: 'needs-artifact-validation' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-artifact',
		sliceId: slice.id,
		evidence: noConfiguredValidationEvidence('slice-branch-validation', 'No Slice Artifact validation is configured.'),
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, stamp, validationEvidence } = await import('../../../utils/test-helpers')

	describe('handleSliceNeedsArtifactValidation', () => {
		it('records passing no-op Slice Artifact validation', async () => {
			const { context, options } = await validationHandlerFixture()
			const slice = options.tx.slices.records.get('slice-1')
			if (slice === undefined) throw new Error('Expected Slice.')

			const result = await handleSliceNeedsArtifactValidation(context, slice, {
				type: 'needs-artifact-validation',
				mode: 'initial',
				sliceArtifactId: 'slice-artifact-1',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-slice-artifact',
					sliceId: 'slice-1',
					evidence: validationEvidence('slice-branch-validation', true, 'No Slice Artifact validation is configured.'),
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		options.tx.sliceArtifacts.records.set('slice-artifact-1', {
			id: 'slice-artifact-1',
			sliceId: 'slice-1',
			config: { type: 'source-control', sliceBranch: 'slice' },
			created: stamp,
		})
		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			options,
			context: { services: options, tx: options.tx, deliveryContext: deliveryContext.value } satisfies DeliveryHandlerContext,
		}
	}
}
