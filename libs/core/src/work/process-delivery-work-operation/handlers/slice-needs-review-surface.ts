import { actionRecord, externalOperationEvidence } from './result'
import type { Action } from '../../../domain/action'
import type { ReviewSurface } from '../../../domain/review-surface'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvariantViolationError } from '../../../errors'
import type { SourceControlCreateReviewSurfaceInput, SourceControlReviewSurfaceCreation } from '../../../utils/providers/source-control'
import type { CoreRuntime } from '../../../utils/runtime'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import { createRecord } from '../../../utils/storage/helpers'
import type { Result as CoreResult } from '../../../utils/types'
import type { ResolvedDeliveryHandlerContext, DeliveryWorkHandlerResult } from '../../delivery-work/types'

type SliceNeedsReviewSurfaceState = Extract<SliceWorkState, { type: 'needs-review-surface' }>

type SliceReviewSurfaceInput = SourceControlCreateReviewSurfaceInput & {
	deliveryId: string
	sliceId: string
	sliceArtifactId: string
}

export async function handleSliceNeedsReviewSurface(
	runtime: CoreRuntime,
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'workResolution' | 'repositoryAccessSecret'>,
	slice: Slice,
	state: SliceNeedsReviewSurfaceState,
): Promise<DeliveryWorkHandlerResult> {
	const input = sliceReviewSurfaceInput(context, slice, state)
	if (!input.ok) return input

	const creation = await runtime.providers.sourceControl.createReviewSurface(input.value)
	if (!creation.ok) return creation

	return runtime.transactions.run(async ({ storage }) =>
		recordSliceReviewSurfaceCreationResult(
			{
				services: runtime.services,
				storage,
				values: runtime.values,
				deliveryContext: context.deliveryContext,
				workResolution: context.workResolution,
				repositoryAccessSecret: context.repositoryAccessSecret,
			},
			slice,
			state,
			input.value,
			creation.value,
		),
	)
}

function sliceReviewSurfaceInput(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'repositoryAccessSecret'>,
	slice: Slice,
	state: SliceNeedsReviewSurfaceState,
): CoreResult<SliceReviewSurfaceInput, InvariantViolationError> {
	const deliveryArtifact = context.deliveryContext.deliveryArtifact
	if (deliveryArtifact === null) {
		return {
			ok: false,
			error: { type: 'invariant-violation', message: 'Slice Review Surface creation requires a Delivery Artifact.' },
		}
	}

	const storedSlice = context.deliveryContext.slices.find((candidate) => candidate.slice.id === slice.id)
	if (storedSlice?.artifact?.id !== state.sliceArtifactId) {
		return {
			ok: false,
			error: { type: 'invariant-violation', message: 'Slice Review Surface creation requires the claimed Slice Artifact.' },
		}
	}

	return {
		ok: true,
		value: {
			deliveryId: context.deliveryContext.delivery.id,
			sliceId: slice.id,
			sliceArtifactId: state.sliceArtifactId,
			repository: context.deliveryContext.repository,
			accessSecret: context.repositoryAccessSecret,
			sourceBranch: storedSlice.artifact.config.sliceBranch,
			targetBranch: deliveryArtifact.config.deliveryBranch,
			title: slice.title,
		},
	}
}

async function recordSliceReviewSurfaceCreationResult(
	context: ResolvedDeliveryHandlerContext,
	slice: Slice,
	_state: SliceNeedsReviewSurfaceState,
	input: SliceReviewSurfaceInput,
	creation: SourceControlReviewSurfaceCreation,
): Promise<DeliveryWorkHandlerResult> {
	switch (creation.type) {
		case 'integrated':
			return writeIntegratedSliceArtifactPromotion(context, slice.id, creation.summary)
		case 'review-surface':
			return writeSliceReviewSurface(context, input, creation)
		case 'failed':
			return writeFailedSliceReviewSurfaceCreation(context, slice.id, creation.summary)
		default:
			throw new Error(`Unexpected Slice review surface creation result: ${String(creation satisfies never)}`)
	}
}

async function writeIntegratedSliceArtifactPromotion(
	context: ResolvedDeliveryHandlerContext,
	sliceId: string,
	summary: string,
): Promise<DeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'promote-slice-artifact',
		sliceId,
		evidence: externalOperationEvidence(summary, 'merge-review-surface', true),
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	return put.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : put
}

async function writeSliceReviewSurface(
	context: ResolvedDeliveryHandlerContext,
	input: SliceReviewSurfaceInput,
	creation: Extract<SourceControlReviewSurfaceCreation, { type: 'review-surface' }>,
): Promise<DeliveryWorkHandlerResult> {
	const reviewSurfaceId = nextId(context.values)
	if (!reviewSurfaceId.ok) return reviewSurfaceId
	const actionId = nextId(context.values)
	if (!actionId.ok) return actionId
	const performed = runtimeRecord(context.values)
	if (!performed.ok) return performed

	const reviewSurface: ReviewSurface = {
		id: reviewSurfaceId.value,
		scope: { type: 'slice', sliceId: input.sliceId, sliceArtifactId: input.sliceArtifactId },
		config: {
			provider: context.deliveryContext.repository.config.provider,
			pullRequestNumber: creation.pullRequestNumber,
			repositoryId: context.deliveryContext.repository.id,
			sourceBranch: input.sourceBranch,
			targetBranch: input.targetBranch,
		},
		title: input.title,
		closed: null,
		created: performed.value,
	}
	const action: Action = {
		id: actionId.value,
		deliveryId: context.deliveryContext.delivery.id,
		performed: performed.value,
		authorized: null,
		result: {
			type: 'create-slice-review-surface',
			sliceId: input.sliceId,
			reviewSurfaceId: reviewSurface.id,
			dispatchStartedActionId: context.dispatchStartedActionId ?? null,
		},
	}

	const actionPut = await createRecord('action', context.storage, action)
	if (!actionPut.ok) return actionPut
	const surfacePut = await createRecord('review-surface', context.storage, reviewSurface)
	return surfacePut.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : surfacePut
}

async function writeFailedSliceReviewSurfaceCreation(
	context: ResolvedDeliveryHandlerContext,
	sliceId: string,
	summary: string,
): Promise<DeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-slice-external-operation-failure',
		sliceId,
		evidence: externalOperationEvidence(summary, 'create-review-surface'),
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	if (!put.ok) return put

	return {
		ok: true,
		value: {
			processedCount: 1,
			failures: [{ scope: { type: 'slice', sliceId }, operation: 'review-surface', summary }],
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { stamp } = await import('../../../utils/test-helpers')
	const { createDeliveryWorkHandlerTestContext } = await import('./test-utils')

	describe('Slice Review Surface creation handler', () => {
		it('stores a Slice Review Surface and Action after provider creation', async () => {
			const { context, slice, state } = await handlerFixture()
			const input = sliceReviewSurfaceInput(context, slice, state)
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordSliceReviewSurfaceCreationResult(context, slice, state, input.value, {
				type: 'review-surface',
				mode: 'created',
				pullRequestNumber: 12,
				summary: 'created',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.reviewSurfaces.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				scope: { type: 'slice', sliceId: '01k00000000000000000000042', sliceArtifactId: '01k00000000000000000000045' },
				config: {
					provider: 'github',
					pullRequestNumber: 12,
					repositoryId: '01k00000000000000000000034',
					sourceBranch: 'slice-branch',
					targetBranch: 'delivery-branch',
				},
				title: 'Slice',
				closed: null,
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('01k00000000000000000010002')?.result).toEqual({
				type: 'create-slice-review-surface',
				sliceId: '01k00000000000000000000042',
				reviewSurfaceId: '01k00000000000000000010001',
				dispatchStartedActionId: null,
			})
		})

		it('records Slice Artifact promotion after provider integration', async () => {
			const { context, slice, state } = await handlerFixture()
			const input = sliceReviewSurfaceInput(context, slice, state)
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordSliceReviewSurfaceCreationResult(context, slice, state, input.value, {
				type: 'integrated',
				summary: 'Already integrated.',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.actions.records.get('01k00000000000000000010001')?.result).toEqual({
				type: 'promote-slice-artifact',
				sliceId: '01k00000000000000000000042',
				evidence: {
					type: 'external-operation',
					operation: { type: 'merge-review-surface' },
					passed: true,
					summary: 'Already integrated.',
				},
				dispatchStartedActionId: null,
			})
		})

		it('records Slice failure Action and result after provider failure', async () => {
			const { context, slice, state } = await handlerFixture()
			const input = sliceReviewSurfaceInput(context, slice, state)
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordSliceReviewSurfaceCreationResult(context, slice, state, input.value, {
				type: 'failed',
				reason: { type: 'provider-unavailable' },
				summary: 'Failed.',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					processedCount: 1,
					failures: [
						{
							scope: { type: 'slice', sliceId: '01k00000000000000000000042' },
							operation: 'review-surface',
							summary: 'Failed.',
						},
					],
				},
			})
			expect(context.tx.actions.records.get('01k00000000000000000010001')?.result).toEqual({
				type: 'record-slice-external-operation-failure',
				sliceId: '01k00000000000000000000042',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-review-surface' },
					passed: false,
					summary: 'Failed.',
				},
				dispatchStartedActionId: null,
			})
		})
	})

	async function handlerFixture() {
		const context = await createDeliveryWorkHandlerTestContext({ sliceId: '01k00000000000000000000042' })
		const sliceArtifact = {
			id: '01k00000000000000000000045',
			sliceId: '01k00000000000000000000042',
			config: { type: 'source-control' as const, sliceBranch: 'slice-branch' },
			created: stamp,
		}
		context.tx.sliceArtifacts.records.set(sliceArtifact.id, sliceArtifact)
		context.deliveryContext.slices[0] = { ...context.deliveryContext.slices[0]!, artifact: sliceArtifact }

		return {
			context,
			slice: context.tx.slices.records.get('01k00000000000000000000042')!,
			state: { type: 'needs-review-surface' as const, sliceArtifactId: '01k00000000000000000000045' },
		}
	}
}
