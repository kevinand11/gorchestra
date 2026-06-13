import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { noConfiguredValidationEvidence, writeValidationAction } from './artifact-validation-recording'

export function handleSliceNeedsDeliveryValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	_state: Extract<SliceWorkState, { type: 'needs-delivery-validation' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-delivery-artifact',
		sliceId: slice.id,
		evidence: noConfiguredValidationEvidence('delivery-branch-validation', 'No Slice Delivery Artifact validation is configured.'),
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, validationEvidence } = await import('../../../utils/test-helpers')

	describe('handleSliceNeedsDeliveryValidation', () => {
		it('records passing no-op Slice Delivery Artifact validation', async () => {
			const { context, options } = await validationHandlerFixture()
			const slice = options.tx.slices.records.get('slice-1')
			if (slice === undefined) throw new Error('Expected Slice.')

			const result = await handleSliceNeedsDeliveryValidation(context, slice, {
				type: 'needs-delivery-validation',
				actionId: 'promote-slice',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-slice-delivery-artifact',
					sliceId: 'slice-1',
					evidence: validationEvidence(
						'delivery-branch-validation',
						true,
						'No Slice Delivery Artifact validation is configured.',
					),
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			options,
			context: { services: options, tx: options.tx, deliveryContext: deliveryContext.value } satisfies DeliveryHandlerContext,
		}
	}
}
