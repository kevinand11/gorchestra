import { actionRecord, externalOperationEvidence, noObservedArtifactCreationWrite } from './artifact-creation-recording'
import type { Action } from '../../../domain/action'
import type { SliceArtifact } from '../../../domain/artifact'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvariantViolationError } from '../../../errors'
import { sourceControlSliceBranchName } from '../../../providers/source-control/branches'
import type { SourceControlArtifactCreation, SourceControlCreateSliceArtifactInput } from '../../../providers/source-control/types'
import type { CoreRuntime } from '../../../runtime'
import { nextId, putRecord, runtimeRecord } from '../../../utils/command-storage'
import { getSliceState } from '../../../utils/delivery-context'
import { withTransaction } from '../../../utils/storage'
import type { Result as CoreResult } from '../../../utils/types'
import { resolvedSchedulerHandlerContext, schedulerHandlerContextFromClaim, type ProviderBackedSchedulerPreflightClaim } from '../preflight'
import type { ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

interface SliceStateCandidate {
	slice: Slice
	state: SliceWorkState
}

export type SliceArtifactCreationInput = SourceControlCreateSliceArtifactInput & {
	deliveryId: string
	sliceId: string
}

export function sliceArtifactCreationInput(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'workResolution'>,
): CoreResult<SliceArtifactCreationInput | null, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const candidates = sliceStateCandidates(context)
	if (!candidates.ok) return candidates
	if (sliceCapacityFull(candidates.value, context)) return { ok: true, value: null }

	const candidate = candidates.value.find((entry) => entry.state.type === 'needs-artifact-creation')
	if (candidate === undefined) return { ok: true, value: null }

	return claimForSlice(context, candidate.slice)
}

export async function handleFirstSliceNeedsArtifactCreation(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<RunDeliveryWorkHandlerResult | null> {
	const prepared = prepareSliceArtifactCreation(preflight)
	if (!prepared.ok) return prepared
	if (prepared.value === null) return null

	return runPreparedSliceArtifactCreation(runtime, preflight, prepared.value)
}

function prepareSliceArtifactCreation(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<SliceArtifactCreationInput | null, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const context = schedulerHandlerContextFromClaim(preflight)
	if (!context.ok) return context

	return sliceArtifactCreationInput(context.value)
}

async function runPreparedSliceArtifactCreation(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
	sliceArtifactCreation: SliceArtifactCreationInput,
): Promise<RunDeliveryWorkHandlerResult> {
	const creation = await runtime.providers.sourceControl.createSliceArtifact(sliceArtifactCreation)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, async (tx) => {
		const freshContext = resolvedSchedulerHandlerContext(runtime.services, tx, preflight.deliveryContext, preflight)
		return freshContext.ok
			? recordSliceArtifactCreationResult(freshContext.value, preflight.state, sliceArtifactCreation, creation.value)
			: freshContext
	})
}

export async function recordSliceArtifactCreationResult(
	context: ResolvedDeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	input: SliceArtifactCreationInput,
	creation: SourceControlArtifactCreation,
): Promise<RunDeliveryWorkHandlerResult> {
	const current = sliceArtifactCreationStillCurrent(context, deliveryState, input)
	if (!current.ok) return current
	if (!current.value) return noObservedArtifactCreationWrite()

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
	return state.type === 'needs-artifact-validation' || state.type === 'needs-delivery-validation'
}

function claimForSlice(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext'>,
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
			sourceBranch: deliveryArtifact.config.deliveryBranch,
			sliceBranch: sliceBranch.value,
		},
	}
}

function sliceArtifactCreationStillCurrent(
	context: ResolvedDeliveryHandlerContext,
	deliveryState: DeliveryWorkState,
	input: SliceArtifactCreationInput,
): CoreResult<boolean, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	if (deliveryState.type !== 'slices-incomplete' || !sliceArtifactInputMatches(context, input)) return { ok: true, value: false }

	const state = getSliceState(context.deliveryContext, input.sliceId)
	if (!state.ok) return state

	return { ok: true, value: state.value.type === 'needs-artifact-creation' }
}

function sliceArtifactInputMatches(context: ResolvedDeliveryHandlerContext, input: SliceArtifactCreationInput): boolean {
	return [
		context.deliveryContext.delivery.id === input.deliveryId,
		context.deliveryContext.deliveryArtifact?.config.deliveryBranch === input.sourceBranch,
	].every(Boolean)
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
	const artifactPut = await putRecord('slice-artifact', context.tx.sliceArtifacts, records.artifact.id, records.artifact)
	if (!artifactPut.ok) return artifactPut

	const actionPut = await putRecord('action', context.tx.actions, records.action.id, records.action)
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

	const actionPut = await putRecord('action', context.tx.actions, action.value.id, action.value)
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
	const id = nextId(context.services, 'slice-artifact')
	if (!id.ok) return id

	const created = runtimeRecord(context.services)
	if (!created.ok) return created

	return {
		ok: true,
		value: {
			id: id.value,
			sliceId: input.sliceId,
			config: { type: 'source-control', sliceBranch: input.sliceBranch },
			created: created.value,
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, localStamp, seedDelivery, seedSelectableModel, seedSlice, stamp } =
		await import('../../../utils/test-helpers')

	describe('Slice Artifact creation handler', () => {
		it('builds deterministic provider input from the Delivery Branch', async () => {
			const context = await handlerContext()

			expect(sliceArtifactCreationInput(context)).toEqual({
				ok: true,
				value: {
					deliveryId: 'delivery-1',
					sliceId: 'slice-1',
					repository: context.deliveryContext.repository,
					sourceBranch: 'delivery-branch',
					sliceBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ/slices/s-c2xpY2UtMQ',
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

		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			services: options,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
			workResolution: {
				workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
				executionModel: options.tx.models.records.get('model-1')!,
				executionModelProvider: options.tx.modelProviders.records.get('model-1-provider')!,
			},
		}
	}
}
