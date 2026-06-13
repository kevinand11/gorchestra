import { noConfiguredValidationEvidence, noObservedArtifactValidationWrite, writeValidationAction } from './artifact-validation-recording'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { getSliceState } from '../../../utils/delivery-context'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

const noConfiguredSliceDeliveryValidation = noConfiguredValidationEvidence(
	'delivery-branch-validation',
	'No Slice Delivery Artifact validation is configured.',
)

export interface SliceDeliveryArtifactValidationClaim {
	deliveryId: string
	sliceId: string
	promotionActionId: string
}

export function sliceDeliveryArtifactValidationClaim(
	context: Pick<DeliveryHandlerContext, 'deliveryContext'>,
): CoreResult<
	SliceDeliveryArtifactValidationClaim | null,
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	for (const slice of context.deliveryContext.slices) {
		const state = getSliceState(context.deliveryContext, slice.slice.id)
		if (!state.ok) return state
		if (state.value.type === 'needs-delivery-validation')
			return { ok: true, value: claimForSliceState(context, slice.slice, state.value) }
	}

	return { ok: true, value: null }
}

export function handleSliceNeedsDeliveryValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'needs-delivery-validation' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	return writePassedSliceDeliveryArtifactValidation(context, claimForSliceState(context, slice, state))
}

export function recordSliceDeliveryArtifactValidationResult(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceDeliveryArtifactValidationClaim,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const current = sliceDeliveryArtifactValidationStillCurrent(context, deliveryState, claim)
	if (!current.ok) return current

	return current.value ? writePassedSliceDeliveryArtifactValidation(context, claim) : noObservedArtifactValidationWrite()
}

function claimForSliceState(
	context: Pick<DeliveryHandlerContext, 'deliveryContext'>,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'needs-delivery-validation' }>,
): SliceDeliveryArtifactValidationClaim {
	return {
		deliveryId: context.deliveryContext.delivery.id,
		sliceId: slice.id,
		promotionActionId: state.actionId,
	}
}

function sliceDeliveryArtifactValidationStillCurrent(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceDeliveryArtifactValidationClaim,
): CoreResult<boolean, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	if (!deliveryStateMatchesClaim(context, deliveryState, claim)) return { ok: true, value: false }

	const state = getSliceState(context.deliveryContext, claim.sliceId)
	return state.ok ? { ok: true, value: sliceStateMatchesValidationClaim(state.value, claim) } : state
}

function deliveryStateMatchesClaim(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceDeliveryArtifactValidationClaim,
): boolean {
	return deliveryState.type === 'slices-incomplete' && context.deliveryContext.delivery.id === claim.deliveryId
}

function sliceStateMatchesValidationClaim(state: SliceWorkState, claim: SliceDeliveryArtifactValidationClaim): boolean {
	return state.type === 'needs-delivery-validation' && state.actionId === claim.promotionActionId
}

function writePassedSliceDeliveryArtifactValidation(
	context: DeliveryHandlerContext,
	claim: SliceDeliveryArtifactValidationClaim,
): Promise<RunDeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-delivery-artifact',
		sliceId: claim.sliceId,
		evidence: noConfiguredSliceDeliveryValidation,
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
