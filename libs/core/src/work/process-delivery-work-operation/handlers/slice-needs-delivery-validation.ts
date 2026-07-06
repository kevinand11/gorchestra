import { noConfiguredValidationEvidence, writeValidationAction } from './artifact-validation-recording'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleSliceNeedsDeliveryValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	_state: Extract<SliceWorkState, { type: 'needs-delivery-validation' }>,
): Promise<DeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-delivery-artifact',
		sliceId: slice.id,
		evidence: noConfiguredValidationEvidence('delivery-branch-validation', 'No Slice Delivery Artifact validation is configured.'),
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, validationEvidence } = await import('../../../utils/test-helpers')

	describe('handleSliceNeedsDeliveryValidation', () => {
		it('records passing no-op Slice Delivery Artifact validation', async () => {
			const { context, options } = await validationHandlerFixture()
			const slice = options.tx.slices.records.get('01k00000000000000000000042')
			if (slice === undefined) throw new Error('Expected Slice.')

			const result = await handleSliceNeedsDeliveryValidation(context, slice, {
				type: 'needs-delivery-validation',
				actionId: 'promote-slice',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-slice-delivery-artifact',
					sliceId: '01k00000000000000000000042',
					evidence: validationEvidence(
						'delivery-branch-validation',
						true,
						'No Slice Delivery Artifact validation is configured.',
					),
					dispatchStartedActionId: null,
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		const deliveryContext = await buildDeliveryContext(options.tx, '01k00000000000000000000008')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			options,
			context: {
				services: options,
				storage: options.tx,
				values: options.values,
				tx: options.tx,
				deliveryContext: deliveryContext.value,
			} satisfies DeliveryHandlerContext,
		}
	}
}
