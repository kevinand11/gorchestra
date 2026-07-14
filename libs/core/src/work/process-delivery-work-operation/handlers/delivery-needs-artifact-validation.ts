import { noConfiguredValidationEvidence, writeValidationAction } from './artifact-validation-recording'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export function handleDeliveryNeedsArtifactValidation(
	context: DeliveryHandlerContext,
	_state: Extract<DeliveryWorkState, { type: 'needs-artifact-validation' }>,
): Promise<DeliveryWorkHandlerResult> | DeliveryWorkHandlerResult {
	return writeValidationAction(context, {
		type: 'validate-delivery-artifact',
		evidence: noConfiguredValidationEvidence('delivery-branch-validation', 'No Delivery Artifact validation is configured.'),
		dispatch: context.dispatch ?? null,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, validationEvidence } = await import('../../../utils/test-helpers')

	describe('handleDeliveryNeedsArtifactValidation', () => {
		it('records passing no-op Delivery Artifact validation', async () => {
			const { context, options } = await validationHandlerFixture()

			const result = await handleDeliveryNeedsArtifactValidation(context, { type: 'needs-artifact-validation' })

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				deliveryId: '01k00000000000000000000008',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-delivery-artifact',
					evidence: validationEvidence('delivery-branch-validation', true, 'No Delivery Artifact validation is configured.'),
					dispatch: null,
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, '01k00000000000000000000008')
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
