import { noConfiguredValidationEvidence, writeValidationAction } from './artifact-validation-recording'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleSliceNeedsArtifactValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	_state: Extract<SliceWorkState, { type: 'needs-artifact-validation' }>,
): Promise<DeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-artifact',
		sliceId: slice.id,
		evidence: noConfiguredValidationEvidence('slice-branch-validation', 'No Slice Artifact validation is configured.'),
		dispatch: context.dispatch ?? null,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, stamp, validationEvidence } = await import('../../../utils/test-helpers')

	describe('handleSliceNeedsArtifactValidation', () => {
		it('records passing no-op Slice Artifact validation', async () => {
			const { context, options } = await validationHandlerFixture()
			const slice = options.tx.slices.records.get('01k00000000000000000000042')
			if (slice === undefined) throw new Error('Expected Slice.')

			const result = await handleSliceNeedsArtifactValidation(context, slice, {
				type: 'needs-artifact-validation',
				mode: 'initial',
				sliceArtifactId: '01k00000000000000000000045',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-slice-artifact',
					sliceId: '01k00000000000000000000042',
					evidence: validationEvidence('slice-branch-validation', true, 'No Slice Artifact validation is configured.'),
					dispatch: null,
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		options.tx.sliceArtifacts.records.set('01k00000000000000000000045', {
			id: '01k00000000000000000000045',
			sliceId: '01k00000000000000000000042',
			config: { type: 'source-control', sliceBranch: 'slice' },
			created: stamp,
		})
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
