import { noConfiguredValidationEvidence, noObservedArtifactValidationWrite, writeValidationAction } from './artifact-validation-recording'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

const noConfiguredDeliveryValidation = noConfiguredValidationEvidence(
	'delivery-branch-validation',
	'No Delivery Artifact validation is configured.',
)

export interface DeliveryArtifactValidationClaim {
	deliveryId: string
}

export function deliveryArtifactValidationClaim(context: Pick<DeliveryHandlerContext, 'deliveryContext'>): DeliveryArtifactValidationClaim {
	return { deliveryId: context.deliveryContext.delivery.id }
}

export function handleDeliveryNeedsArtifactValidation(
	context: DeliveryHandlerContext,
	state: Extract<DeliveryWorkState, { type: 'needs-artifact-validation' }>,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return recordDeliveryArtifactValidationResult(context, state, deliveryArtifactValidationClaim(context))
}

export function recordDeliveryArtifactValidationResult(
	context: DeliveryHandlerContext,
	state: DeliveryWorkState,
	claim: DeliveryArtifactValidationClaim,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	return deliveryArtifactValidationStillCurrent(context, state, claim)
		? writePassedDeliveryArtifactValidation(context)
		: noObservedArtifactValidationWrite()
}

function deliveryArtifactValidationStillCurrent(
	context: DeliveryHandlerContext,
	state: DeliveryWorkState,
	claim: DeliveryArtifactValidationClaim,
): boolean {
	return state.type === 'needs-artifact-validation' && context.deliveryContext.delivery.id === claim.deliveryId
}

function writePassedDeliveryArtifactValidation(context: DeliveryHandlerContext): Promise<RunDeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-delivery-artifact',
		evidence: noConfiguredDeliveryValidation,
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
			expect(options.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: {
					type: 'validate-delivery-artifact',
					evidence: validationEvidence('delivery-branch-validation', true, 'No Delivery Artifact validation is configured.'),
				},
			})
		})
	})

	async function validationHandlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			options,
			context: { services: options, tx: options.tx, deliveryContext: deliveryContext.value } satisfies DeliveryHandlerContext,
		}
	}
}
