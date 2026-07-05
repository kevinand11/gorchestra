import { actionRecord, externalOperationEvidence } from './result'
import type { Action } from '../../../domain/action'
import type { ReviewSurface } from '../../../domain/review-surface'
import type { InvariantViolationError } from '../../../errors'
import type { SourceControlCreateReviewSurfaceInput, SourceControlReviewSurfaceCreation } from '../../../providers/source-control'
import type { CoreRuntime } from '../../../runtime'
import { createRecord, withTransaction } from '../../../storage/helpers'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import { resolvedSchedulerHandlerContext, schedulerHandlerContextFromClaim, type ProviderBackedSchedulerPreflightClaim } from '../preflight'
import type { ResolvedDeliveryHandlerContext, ScheduleDeliveryWorkHandlerResult } from '../types'

type DeliveryReviewSurfaceState = Extract<ProviderBackedSchedulerPreflightClaim['state'], { type: 'needs-review-surface' }>

type DeliveryReviewSurfaceInput = SourceControlCreateReviewSurfaceInput & {
	deliveryId: string
	deliveryArtifactId: string
}

type DeliveryReviewSurfaceClaim = Pick<ProviderBackedSchedulerPreflightClaim, 'deliveryContext'> &
	Pick<ResolvedDeliveryHandlerContext, 'repositoryAccessSecret'> & { state: DeliveryReviewSurfaceState }

export async function handleDeliveryNeedsReviewSurface(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const state = preflight.state
	if (state.type !== 'needs-review-surface') return deliveryReviewSurfaceStateInvariant()

	const claim = { ...preflight, state }
	const input = deliveryReviewSurfaceInputFromPreflight(claim)
	return input.ok ? createDeliveryReviewSurface(runtime, claim, input.value) : input
}

function deliveryReviewSurfaceInputFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim & { state: DeliveryReviewSurfaceState },
): CoreResult<DeliveryReviewSurfaceInput, ScheduleDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const context = schedulerHandlerContextFromClaim(preflight)
	return context.ok
		? deliveryReviewSurfaceInput({
				deliveryContext: preflight.deliveryContext,
				repositoryAccessSecret: context.value.repositoryAccessSecret,
				state: preflight.state,
			})
		: context
}

async function createDeliveryReviewSurface(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim & { state: DeliveryReviewSurfaceState },
	input: DeliveryReviewSurfaceInput,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const creation = await runtime.providers.sourceControl.createReviewSurface(input)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, async (storage) => {
		const context = resolvedSchedulerHandlerContext(runtime, storage, preflight.deliveryContext, preflight)
		return context.ok ? recordDeliveryReviewSurfaceCreationResult(context.value, preflight.state, input, creation.value) : context
	})
}

function deliveryReviewSurfaceStateInvariant(): ScheduleDeliveryWorkHandlerResult {
	return {
		ok: false,
		error: { type: 'invariant-violation', message: 'Delivery Review Surface creation requires needs-review-surface state.' },
	}
}

function deliveryReviewSurfaceInput(claim: DeliveryReviewSurfaceClaim): CoreResult<DeliveryReviewSurfaceInput, InvariantViolationError> {
	const deliveryArtifact = claim.deliveryContext.deliveryArtifact
	if (deliveryArtifact === null || deliveryArtifact.id !== claim.state.deliveryArtifactId) {
		return {
			ok: false,
			error: { type: 'invariant-violation', message: 'Delivery Review Surface creation requires the claimed Delivery Artifact.' },
		}
	}

	return {
		ok: true,
		value: {
			deliveryId: claim.deliveryContext.delivery.id,
			deliveryArtifactId: deliveryArtifact.id,
			repository: claim.deliveryContext.repository,
			accessSecret: claim.repositoryAccessSecret,
			sourceBranch: deliveryArtifact.config.deliveryBranch,
			targetBranch: claim.deliveryContext.delivery.target.targetBranch,
			title: claim.deliveryContext.delivery.title,
		},
	}
}

async function recordDeliveryReviewSurfaceCreationResult(
	context: ResolvedDeliveryHandlerContext,
	_state: DeliveryReviewSurfaceState,
	input: DeliveryReviewSurfaceInput,
	creation: SourceControlReviewSurfaceCreation,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	switch (creation.type) {
		case 'integrated':
			return writeIntegratedDeliveryArtifactObservation(context, creation.summary)
		case 'review-surface':
			return writeDeliveryReviewSurface(context, input, creation)
		case 'failed':
			return writeFailedDeliveryReviewSurfaceCreation(context, creation.summary)
		default:
			throw new Error(`Unexpected Delivery review surface creation result: ${String(creation satisfies never)}`)
	}
}

async function writeIntegratedDeliveryArtifactObservation(
	context: ResolvedDeliveryHandlerContext,
	summary: string,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'observe-delivery-artifact-integration',
		evidence: externalOperationEvidence(summary, 'observe-artifact-integration', true),
	})
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	return put.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : put
}

async function writeDeliveryReviewSurface(
	context: ResolvedDeliveryHandlerContext,
	input: DeliveryReviewSurfaceInput,
	creation: Extract<SourceControlReviewSurfaceCreation, { type: 'review-surface' }>,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const records = deliveryReviewSurfaceRecords(context, input, creation.pullRequestNumber)
	return records.ok ? putDeliveryReviewSurfaceRecords(context, records.value) : records
}

function deliveryReviewSurfaceRecords(
	context: ResolvedDeliveryHandlerContext,
	input: DeliveryReviewSurfaceInput,
	pullRequestNumber: number,
): CoreResult<
	{ reviewSurface: ReviewSurface; action: Action },
	ScheduleDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const reviewSurfaceId = nextId(context.values, 'review-surface')
	if (!reviewSurfaceId.ok) return reviewSurfaceId

	const actionId = nextId(context.values, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(context.values)
	if (!performed.ok) return performed

	return {
		ok: true,
		value: {
			reviewSurface: {
				id: reviewSurfaceId.value,
				scope: { type: 'delivery', deliveryId: input.deliveryId, deliveryArtifactId: input.deliveryArtifactId },
				config: {
					provider: context.deliveryContext.repository.config.provider,
					pullRequestNumber,
					repositoryId: context.deliveryContext.repository.id,
					sourceBranch: input.sourceBranch,
					targetBranch: input.targetBranch,
				},
				title: input.title,
				closed: null,
				created: performed.value,
			},
			action: {
				id: actionId.value,
				deliveryId: context.deliveryContext.delivery.id,
				performed: performed.value,
				authorized: null,
				result: { type: 'create-delivery-review-surface', reviewSurfaceId: reviewSurfaceId.value },
			},
		},
	}
}

async function putDeliveryReviewSurfaceRecords(
	context: ResolvedDeliveryHandlerContext,
	records: { reviewSurface: ReviewSurface; action: Action },
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const surfacePut = await createRecord('review-surface', context.storage, records.reviewSurface)
	if (!surfacePut.ok) return surfacePut

	const actionPut = await createRecord('action', context.storage, records.action)
	return actionPut.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : actionPut
}

async function writeFailedDeliveryReviewSurfaceCreation(
	context: ResolvedDeliveryHandlerContext,
	summary: string,
): Promise<ScheduleDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-delivery-external-operation-failure',
		evidence: externalOperationEvidence(summary, 'create-review-surface'),
	})
	if (!action.ok) return action

	const put = await createRecord('action', context.storage, action.value)
	if (!put.ok) return put

	return {
		ok: true,
		value: {
			processedCount: 1,
			failures: [{ scope: { type: 'delivery' }, operation: 'review-surface', summary }],
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createScheduleDeliveryWorkHandlerTestContext } = await import('./test-utils')

	describe('Delivery Review Surface creation handler', () => {
		it('stores a Delivery Review Surface and Action after provider creation', async () => {
			const context = await handlerContext()
			const input = deliveryReviewSurfaceInput({
				deliveryContext: context.deliveryContext,
				repositoryAccessSecret: context.repositoryAccessSecret,
				state: needsReviewSurfaceState(),
			})
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordDeliveryReviewSurfaceCreationResult(context, needsReviewSurfaceState(), input.value, {
				type: 'review-surface',
				mode: 'created',
				pullRequestNumber: 12,
				summary: 'created',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.reviewSurfaces.records.get('review-surface-1')).toEqual({
				id: 'review-surface-1',
				scope: { type: 'delivery', deliveryId: 'delivery-1', deliveryArtifactId: 'delivery-artifact-1' },
				config: {
					provider: 'github',
					pullRequestNumber: 12,
					repositoryId: 'repository-1',
					sourceBranch: 'delivery-branch',
					targetBranch: 'main',
				},
				title: 'Delivery',
				closed: null,
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'create-delivery-review-surface', reviewSurfaceId: 'review-surface-1' },
			})
		})

		it('records observed Delivery Artifact integration after provider integration', async () => {
			const context = await handlerContext()
			const input = deliveryReviewSurfaceInput({
				deliveryContext: context.deliveryContext,
				repositoryAccessSecret: context.repositoryAccessSecret,
				state: needsReviewSurfaceState(),
			})
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordDeliveryReviewSurfaceCreationResult(context, needsReviewSurfaceState(), input.value, {
				type: 'integrated',
				summary: 'Already integrated.',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'observe-delivery-artifact-integration',
				evidence: {
					type: 'external-operation',
					operation: { type: 'observe-artifact-integration' },
					passed: true,
					summary: 'Already integrated.',
				},
			})
		})

		it('records failure Action and result after provider failure', async () => {
			const context = await handlerContext()
			const input = deliveryReviewSurfaceInput({
				deliveryContext: context.deliveryContext,
				repositoryAccessSecret: context.repositoryAccessSecret,
				state: needsReviewSurfaceState(),
			})
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordDeliveryReviewSurfaceCreationResult(context, needsReviewSurfaceState(), input.value, {
				type: 'failed',
				reason: { type: 'provider-unavailable' },
				summary: 'Failed.',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					processedCount: 1,
					failures: [{ scope: { type: 'delivery' }, operation: 'review-surface', summary: 'Failed.' }],
				},
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'record-delivery-external-operation-failure',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-review-surface' },
					passed: false,
					summary: 'Failed.',
				},
			})
		})
	})

	function needsReviewSurfaceState(): DeliveryReviewSurfaceState {
		return { type: 'needs-review-surface', deliveryArtifactId: 'delivery-artifact-1' }
	}

	async function handlerContext() {
		return createScheduleDeliveryWorkHandlerTestContext()
	}
}
