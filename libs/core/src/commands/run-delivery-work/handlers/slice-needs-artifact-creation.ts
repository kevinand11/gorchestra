import type { Action } from '../../../domain/action'
import type { SliceArtifact } from '../../../domain/artifact'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvariantViolationError } from '../../../errors'
import { sourceControlSliceBranchName } from '../../../providers/source-control/branches'
import type { SourceControlArtifactCreation, SourceControlCreateArtifactBranchInput } from '../../../providers/source-control/types'
import type { CoreRuntime } from '../../../runtime'
import { createRecord, nextId, runtimeRecord } from '../../../utils/command-storage'
import { getSliceState } from '../../../utils/delivery-context'
import { withTransaction } from '../../../utils/storage'
import type { Result as CoreResult } from '../../../utils/types'
import type { ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { actionRecord, externalOperationEvidence } from './result'

interface SliceStateCandidate {
	slice: Slice
	state: SliceWorkState
}

export type SliceArtifactCreationInput = SourceControlCreateArtifactBranchInput & {
	deliveryId: string
	sliceId: string
}

export function sliceArtifactCreationInput(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'workResolution' | 'repositoryAccessSecret'>,
): CoreResult<SliceArtifactCreationInput | null, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const candidates = sliceStateCandidates(context)
	if (!candidates.ok) return candidates
	if (sliceCapacityFull(candidates.value, context)) return { ok: true, value: null }

	const candidate = candidates.value.find((entry) => entry.state.type === 'needs-artifact-creation')
	if (candidate === undefined) return { ok: true, value: null }

	return sliceArtifactCreationInputForSlice(context, candidate.slice)
}

export async function handleSliceNeedsArtifactCreation(
	runtime: CoreRuntime,
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'workResolution' | 'repositoryAccessSecret'>,
	slice: Slice,
	_state: Extract<SliceWorkState, { type: 'needs-artifact-creation' }>,
): Promise<RunDeliveryWorkHandlerResult> {
	const input = sliceArtifactCreationInputForSlice(context, slice)
	if (!input.ok) return input

	const creation = await runtime.providers.sourceControl.createArtifactBranch(input.value)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, async (storage) =>
		recordSliceArtifactCreationResult(
			{
				services: runtime.services,
				storage,
				values: runtime.values,
				deliveryContext: context.deliveryContext,
				workResolution: context.workResolution,
				repositoryAccessSecret: context.repositoryAccessSecret,
			},
			{ type: 'slices-incomplete' },
			input.value,
			creation.value,
		),
	)
}

export async function recordSliceArtifactCreationResult(
	context: ResolvedDeliveryHandlerContext,
	_deliveryState: DeliveryWorkState,
	input: SliceArtifactCreationInput,
	creation: SourceControlArtifactCreation,
): Promise<RunDeliveryWorkHandlerResult> {
	return creation.type === 'passed'
		? writePassedSliceArtifactCreation(context, input)
		: writeFailedSliceArtifactCreation(context, input.sliceId, creation.summary)
}

function sliceStateCandidates(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext'>,
): CoreResult<SliceStateCandidate[], RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const candidates: SliceStateCandidate[] = []
	for (const slice of context.deliveryContext.slices) {
		const state = getSliceState(context.deliveryContext, slice.slice.id)
		if (!state.ok) return state
		candidates.push({ slice: slice.slice, state: state.value })
	}

	return { ok: true, value: candidates }
}

function sliceCapacityFull(candidates: SliceStateCandidate[], context: Pick<ResolvedDeliveryHandlerContext, 'workResolution'>): boolean {
	const activeSlots = candidates.filter((candidate) => isActiveSliceSlotState(candidate.state)).length
	return activeSlots >= context.workResolution.workConfig.maxProcessableSliceSlots
}

function isActiveSliceSlotState(state: SliceWorkState): boolean {
	return state.type === 'needs-artifact-validation' || state.type === 'needs-delivery-validation' || state.type === 'needs-review-surface'
}

function sliceArtifactCreationInputForSlice(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'repositoryAccessSecret'>,
	slice: Slice,
): CoreResult<SliceArtifactCreationInput, InvariantViolationError> {
	const deliveryArtifact = context.deliveryContext.deliveryArtifact
	if (deliveryArtifact === null) {
		return { ok: false, error: { type: 'invariant-violation', message: 'Slice Artifact creation requires a Delivery Artifact.' } }
	}

	const sliceBranch = sourceControlSliceBranchName(context.deliveryContext.delivery.id, slice.id)
	if (!sliceBranch.ok) return sliceBranch

	return {
		ok: true,
		value: {
			deliveryId: context.deliveryContext.delivery.id,
			sliceId: slice.id,
			repository: context.deliveryContext.repository,
			accessSecret: context.repositoryAccessSecret,
			sourceBranch: deliveryArtifact.config.deliveryBranch,
			artifactBranch: sliceBranch.value,
		},
	}
}

async function writePassedSliceArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	input: SliceArtifactCreationInput,
): Promise<RunDeliveryWorkHandlerResult> {
	const records = sliceArtifactCreationRecords(context, input)
	return records.ok ? putSliceArtifactCreationRecords(context, records.value) : records
}

function sliceArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	input: SliceArtifactCreationInput,
): CoreResult<
	{ artifact: SliceArtifact; action: Action },
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const artifact = sliceArtifactRecord(context, input)
	if (!artifact.ok) return artifact

	const action = actionRecord(context, {
		type: 'create-slice-artifact',
		sliceId: input.sliceId,
		sliceArtifactId: artifact.value.id,
	})
	return action.ok ? { ok: true, value: { artifact: artifact.value, action: action.value } } : action
}

async function putSliceArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	records: { artifact: SliceArtifact; action: Action },
): Promise<RunDeliveryWorkHandlerResult> {
	const artifactPut = await createRecord('slice-artifact', context.storage, records.artifact)
	if (!artifactPut.ok) return artifactPut

	const actionPut = await createRecord('action', context.storage, records.action)
	if (!actionPut.ok) return actionPut

	return { ok: true, value: { processedCount: 1, failures: [] } }
}

async function writeFailedSliceArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	sliceId: string,
	summary: string,
): Promise<RunDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-slice-external-operation-failure',
		sliceId,
		evidence: externalOperationEvidence(summary),
	})
	if (!action.ok) return action

	const actionPut = await createRecord('action', context.storage, action.value)
	if (!actionPut.ok) return actionPut

	return {
		ok: true,
		value: {
			processedCount: 1,
			failures: [{ scope: { type: 'slice', sliceId }, operation: 'create-artifact', summary }],
		},
	}
}

function sliceArtifactRecord(
	context: ResolvedDeliveryHandlerContext,
	input: SliceArtifactCreationInput,
): CoreResult<SliceArtifact, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.values, 'slice-artifact')
	if (!id.ok) return id

	const created = runtimeRecord(context.values)
	if (!created.ok) return created

	return {
		ok: true,
		value: {
			id: id.value,
			sliceId: input.sliceId,
			config: { type: 'source-control', sliceBranch: input.artifactBranch },
			created: created.value,
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createRunDeliveryWorkHandlerTestContext } = await import('./test-utils')

	describe('Slice Artifact creation handler', () => {
		it('builds deterministic provider input from the Delivery Branch', async () => {
			const context = await handlerContext()

			expect(sliceArtifactCreationInput(context)).toEqual({
				ok: true,
				value: {
					deliveryId: 'delivery-1',
					sliceId: 'slice-1',
					repository: context.deliveryContext.repository,
					accessSecret: context.repositoryAccessSecret,
					sourceBranch: 'delivery-branch',
					artifactBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ',
				},
			})
		})

		it('stores a Slice Artifact and Action after provider success', async () => {
			const context = await handlerContext()
			const input = sliceArtifactCreationInput(context)
			if (!input.ok || input.value === null) throw new Error('Expected input.')

			const result = await recordSliceArtifactCreationResult(context, { type: 'slices-incomplete' }, input.value, {
				type: 'passed',
				mode: 'created',
				summary: 'created',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.sliceArtifacts.records.get('slice-artifact-1')).toEqual({
				id: 'slice-artifact-1',
				sliceId: 'slice-1',
				config: { type: 'source-control', sliceBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ' },
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-slice-artifact',
				sliceId: 'slice-1',
				sliceArtifactId: 'slice-artifact-1',
			})
		})

		it('records external-operation failure evidence after provider failure', async () => {
			const context = await handlerContext()
			const input = sliceArtifactCreationInput(context)
			if (!input.ok || input.value === null) throw new Error('Expected input.')

			const result = await recordSliceArtifactCreationResult(context, { type: 'slices-incomplete' }, input.value, {
				type: 'failed',
				reason: { type: 'artifact-branch-diverged', branch: 'slice', sourceBranch: 'delivery' },
				summary: 'GitHub artifact branch diverged from its source branch.',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					processedCount: 1,
					failures: [
						{
							scope: { type: 'slice', sliceId: 'slice-1' },
							operation: 'create-artifact',
							summary: 'GitHub artifact branch diverged from its source branch.',
						},
					],
				},
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'record-slice-external-operation-failure',
				sliceId: 'slice-1',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-artifact' },
					passed: false,
					summary: 'GitHub artifact branch diverged from its source branch.',
				},
			})
		})
	})

	async function handlerContext() {
		return createRunDeliveryWorkHandlerTestContext({ sliceId: 'slice-1' })
	}
}
