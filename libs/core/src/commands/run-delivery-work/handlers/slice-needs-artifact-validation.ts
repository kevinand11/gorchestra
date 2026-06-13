import { noConfiguredValidationEvidence, noObservedArtifactValidationWrite, writeValidationAction } from './artifact-validation-recording'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { getSliceState } from '../../../utils/delivery-context'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

const noConfiguredSliceValidation = noConfiguredValidationEvidence('slice-branch-validation', 'No Slice Artifact validation is configured.')

export interface SliceArtifactValidationClaim {
	deliveryId: string
	sliceId: string
	sliceArtifactId: string
}

export function sliceArtifactValidationClaim(
	context: Pick<DeliveryHandlerContext, 'deliveryContext'>,
): CoreResult<
	SliceArtifactValidationClaim | null,
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	for (const slice of context.deliveryContext.slices) {
		const state = getSliceState(context.deliveryContext, slice.slice.id)
		if (!state.ok) return state
		if (state.value.type === 'needs-artifact-validation')
			return { ok: true, value: claimForSliceState(context, slice.slice, state.value) }
	}

	return { ok: true, value: null }
}

export function handleSliceNeedsArtifactValidation(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'needs-artifact-validation' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	return writePassedSliceArtifactValidation(context, claimForSliceState(context, slice, state))
}

export function recordSliceArtifactValidationResult(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceArtifactValidationClaim,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const current = sliceArtifactValidationStillCurrent(context, deliveryState, claim)
	if (!current.ok) return current

	return current.value ? writePassedSliceArtifactValidation(context, claim) : noObservedArtifactValidationWrite()
}

function claimForSliceState(
	context: Pick<DeliveryHandlerContext, 'deliveryContext'>,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'needs-artifact-validation' }>,
): SliceArtifactValidationClaim {
	return {
		deliveryId: context.deliveryContext.delivery.id,
		sliceId: slice.id,
		sliceArtifactId: state.sliceArtifactId,
	}
}

function sliceArtifactValidationStillCurrent(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceArtifactValidationClaim,
): CoreResult<boolean, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	if (!deliveryStateMatchesClaim(context, deliveryState, claim)) return { ok: true, value: false }

	const state = getSliceState(context.deliveryContext, claim.sliceId)
	return state.ok ? { ok: true, value: sliceStateMatchesValidationClaim(state.value, claim) } : state
}

function deliveryStateMatchesClaim(
	context: DeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	claim: SliceArtifactValidationClaim,
): boolean {
	return deliveryState.type === 'slices-incomplete' && context.deliveryContext.delivery.id === claim.deliveryId
}

function sliceStateMatchesValidationClaim(state: SliceWorkState, claim: SliceArtifactValidationClaim): boolean {
	return state.type === 'needs-artifact-validation' && state.sliceArtifactId === claim.sliceArtifactId
}

function writePassedSliceArtifactValidation(
	context: DeliveryHandlerContext,
	claim: SliceArtifactValidationClaim,
): Promise<RunDeliveryWorkHandlerResult> {
	return writeValidationAction(context, {
		type: 'validate-slice-artifact',
		sliceId: claim.sliceId,
		evidence: noConfiguredSliceValidation,
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
