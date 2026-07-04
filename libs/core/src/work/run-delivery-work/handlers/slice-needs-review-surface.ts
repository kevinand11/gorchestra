import { actionRecord, externalOperationEvidence } from './result'
import type { Action } from '../../../domain/action'
import type { ReviewSurface } from '../../../domain/review-surface'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvariantViolationError } from '../../../errors'
import type { SourceControlCreateReviewSurfaceInput, SourceControlReviewSurfaceCreation } from '../../../providers/source-control'
import type { CoreRuntime } from '../../../runtime'
import { createRecord, withTransaction } from '../../../storage/helpers'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

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
): Promise<RunDeliveryWorkHandlerResult> {
	const input = sliceReviewSurfaceInput(context, slice, state)
	if (!input.ok) return input

	const creation = await runtime.providers.sourceControl.createReviewSurface(input.value)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, async (storage) =>
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
	if (deliveryArtifact === null) return missingSliceReviewSurfaceDeliveryArtifact()

	const sliceArtifact = claimedSliceArtifact(context, slice, state)
	if (!sliceArtifact.ok) return sliceArtifact

	return {
		ok: true,
		value: {
			deliveryId: context.deliveryContext.delivery.id,
			sliceId: slice.id,
			sliceArtifactId: state.sliceArtifactId,
			repository: context.deliveryContext.repository,
			accessSecret: context.repositoryAccessSecret,
			sourceBranch: sliceArtifact.value.config.sliceBranch,
			targetBranch: deliveryArtifact.config.deliveryBranch,
			title: slice.title,
		},
	}
}

function claimedSliceArtifact(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext'>,
	slice: Slice,
	state: SliceNeedsReviewSurfaceState,
) {
	const storedSlice = context.deliveryContext.slices.find((candidate) => candidate.slice.id === slice.id)
	return storedSlice?.artifact?.id === state.sliceArtifactId
		? { ok: true as const, value: storedSlice.artifact }
		: missingClaimedSliceArtifact()
}

function missingSliceReviewSurfaceDeliveryArtifact(): CoreResult<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message: 'Slice Review Surface creation requires a Delivery Artifact.' } }
}

function missingClaimedSliceArtifact(): CoreResult<never, InvariantViolationError> {
	return {
		ok: false,
		error: { type: 'invariant-violation', message: 'Slice Review Surface creation requires the claimed Slice Artifact.' },
	}
}

async function recordSliceReviewSurfaceCreationResult(
	context: ResolvedDeliveryHandlerContext,
	slice: Slice,
	_state: SliceNeedsReviewSurfaceState,
	input: SliceReviewSurfaceInput,
	creation: SourceControlReviewSurfaceCreation,
): Promise<RunDeliveryWorkHandlerResult> {
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
): Promise<RunDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'promote-slice-artifact',
		sliceId,
		evidence: externalOperationEvidence(summary, 'merge-review-surface', true),
	})
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	return put.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : put
}

async function writeSliceReviewSurface(
	context: ResolvedDeliveryHandlerContext,
	input: SliceReviewSurfaceInput,
	creation: Extract<SourceControlReviewSurfaceCreation, { type: 'review-surface' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	const records = sliceReviewSurfaceRecords(context, input, creation.pullRequestNumber)
	return records.ok ? putSliceReviewSurfaceRecords(context, records.value) : records
}

function sliceReviewSurfaceRecords(
	context: ResolvedDeliveryHandlerContext,
	input: SliceReviewSurfaceInput,
	pullRequestNumber: number,
): CoreResult<
	{ reviewSurface: ReviewSurface; action: Action },
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const identifiers = sliceReviewSurfaceIdentifiers(context)
	if (!identifiers.ok) return identifiers

	const performed = runtimeRecord(context.values)
	if (!performed.ok) return performed

	const reviewSurface = sliceReviewSurfaceRecord(context, input, pullRequestNumber, identifiers.value.reviewSurfaceId, performed.value)
	const action = sliceReviewSurfaceCreationAction(context, input.sliceId, reviewSurface.id, identifiers.value.actionId, performed.value)
	return { ok: true, value: { reviewSurface, action } }
}

function sliceReviewSurfaceIdentifiers(
	context: ResolvedDeliveryHandlerContext,
): CoreResult<
	{ reviewSurfaceId: string; actionId: string },
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const reviewSurfaceId = nextId(context.values, 'review-surface')
	if (!reviewSurfaceId.ok) return reviewSurfaceId

	const actionId = nextId(context.values, 'action')
	return actionId.ok ? { ok: true, value: { reviewSurfaceId: reviewSurfaceId.value, actionId: actionId.value } } : actionId
}

async function putSliceReviewSurfaceRecords(
	context: ResolvedDeliveryHandlerContext,
	records: { reviewSurface: ReviewSurface; action: Action },
): Promise<RunDeliveryWorkHandlerResult> {
	const actionPut = await createRecord('action', context.storage, records.action)
	if (!actionPut.ok) return actionPut

	const surfacePut = await createRecord('review-surface', context.storage, records.reviewSurface)
	return surfacePut.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : surfacePut
}

function sliceReviewSurfaceRecord(
	context: ResolvedDeliveryHandlerContext,
	input: SliceReviewSurfaceInput,
	pullRequestNumber: number,
	reviewSurfaceId: string,
	created: ReviewSurface['created'],
): ReviewSurface {
	return {
		id: reviewSurfaceId,
		scope: { type: 'slice', sliceId: input.sliceId, sliceArtifactId: input.sliceArtifactId },
		config: {
			provider: context.deliveryContext.repository.config.provider,
			pullRequestNumber,
			repositoryId: context.deliveryContext.repository.id,
			sourceBranch: input.sourceBranch,
			targetBranch: input.targetBranch,
		},
		title: input.title,
		closed: null,
		created,
	}
}

function sliceReviewSurfaceCreationAction(
	context: ResolvedDeliveryHandlerContext,
	sliceId: string,
	reviewSurfaceId: string,
	actionId: string,
	performed: Action['performed'],
): Action {
	return {
		id: actionId,
		deliveryId: context.deliveryContext.delivery.id,
		performed,
		authorized: null,
		result: { type: 'create-slice-review-surface', sliceId, reviewSurfaceId },
	}
}

async function writeFailedSliceReviewSurfaceCreation(
	context: ResolvedDeliveryHandlerContext,
	sliceId: string,
	summary: string,
): Promise<RunDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-slice-external-operation-failure',
		sliceId,
		evidence: externalOperationEvidence(summary, 'create-review-surface'),
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
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, localStamp, seedDelivery, seedSelectableModel, seedSlice, stamp } =
		await import('../../../utils/test-helpers')

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
			expect(context.tx.reviewSurfaces.records.get('review-surface-1')).toEqual({
				id: 'review-surface-1',
				scope: { type: 'slice', sliceId: 'slice-1', sliceArtifactId: 'slice-artifact-1' },
				config: {
					provider: 'github',
					pullRequestNumber: 12,
					repositoryId: 'repository-1',
					sourceBranch: 'slice-branch',
					targetBranch: 'delivery-branch',
				},
				title: 'Slice',
				closed: null,
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-slice-review-surface',
				sliceId: 'slice-1',
				reviewSurfaceId: 'review-surface-1',
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
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'promote-slice-artifact',
				sliceId: 'slice-1',
				evidence: {
					type: 'external-operation',
					operation: { type: 'merge-review-surface' },
					passed: true,
					summary: 'Already integrated.',
				},
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
					failures: [{ scope: { type: 'slice', sliceId: 'slice-1' }, operation: 'review-surface', summary: 'Failed.' }],
				},
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'record-slice-external-operation-failure',
				sliceId: 'slice-1',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-review-surface' },
					passed: false,
					summary: 'Failed.',
				},
			})
		})
	})

	async function handlerFixture() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSelectableModel(options.tx, 'model-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')
		options.tx.deliveries.records.get('delivery-1')!.queued = localStamp()
		options.tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery-branch' },
			created: stamp,
		})
		options.tx.sliceArtifacts.records.set('slice-artifact-1', {
			id: 'slice-artifact-1',
			sliceId: 'slice-1',
			config: { type: 'source-control', sliceBranch: 'slice-branch' },
			created: stamp,
		})

		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		const context = {
			services: options,
			storage: options.tx,
			values: options.values,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
			workResolution: {
				workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
				executionModelUse: { modelId: 'model-1', thinkingLevel: 'none' as const },
				executionModel: options.tx.models.records.get('model-1')!,
				executionModelProvider: options.tx.modelProviders.records.get('model-1-provider')!,
			},
			repositoryAccessSecret: { secretId: 'secret-1', valueRef: 'protected-ref' },
		} satisfies ResolvedDeliveryHandlerContext

		return {
			context,
			slice: options.tx.slices.records.get('slice-1')!,
			state: { type: 'needs-review-surface' as const, sliceArtifactId: 'slice-artifact-1' },
		}
	}
}
