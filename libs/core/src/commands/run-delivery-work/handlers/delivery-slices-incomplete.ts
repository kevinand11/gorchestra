import { noEligibleWork, sliceCapacityFull } from './result'
import { handleSliceWorkState, isActiveSliceSlotState } from './slice'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvalidInputError } from '../../../errors'
import { getSliceState, resolveDeliveryWork } from '../../../utils/delivery-context'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryWorkResolution, Error, ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'

interface SliceStateCandidate {
	slice: Slice
	state: SliceWorkState
}

export async function handleDeliverySlicesIncomplete(context: ResolvedDeliveryHandlerContext): Promise<RunDeliveryWorkHandlerResult> {
	const candidates = sliceStateCandidates(context)
	return candidates.ok ? handleSliceCandidates(context, candidates.value) : candidates
}

function handleSliceCandidates(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const prioritizedResult = handlePrioritizedSliceValidation(context, candidates)
	if (prioritizedResult !== null) return prioritizedResult

	const capacityResult = capacityCheck(candidates, context.workResolution)
	return capacityResult ?? handleFirstExecutableSlice(context, candidates, context.workResolution)
}

function handlePrioritizedSliceValidation(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult | null {
	return (
		handleFirstSliceDeliveryArtifactValidation(context, candidates, context.workResolution) ??
		handleFirstSliceArtifactValidation(context, candidates, context.workResolution)
	)
}

function sliceStateCandidates(
	context: ResolvedDeliveryHandlerContext,
): CoreResult<SliceStateCandidate[], Exclude<Error, InvalidInputError>> {
	const candidates: SliceStateCandidate[] = []
	for (const slice of context.deliveryContext.slices) {
		const stateResult = getSliceState(context.deliveryContext, slice.slice.id)
		if (!stateResult.ok) return stateResult
		candidates.push({ slice: slice.slice, state: stateResult.value })
	}

	return { ok: true, value: candidates }
}

function capacityCheck(candidates: SliceStateCandidate[], resolution: DeliveryWorkResolution): RunDeliveryWorkHandlerResult | null {
	const activeSlots = candidates.filter((candidate) => isActiveSliceSlotState(candidate.state)).length

	return activeSlots >= resolution.workConfig.maxProcessableSliceSlots
		? sliceCapacityFull(activeSlots, resolution.workConfig.maxProcessableSliceSlots)
		: null
}

function handleFirstSliceDeliveryArtifactValidation(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult | null {
	return handleFirstSliceState(context, candidates, resolution, 'needs-delivery-validation')
}

function handleFirstSliceArtifactValidation(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult | null {
	return handleFirstSliceState(context, candidates, resolution, 'needs-artifact-validation')
}

function handleFirstSliceState(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
	resolution: DeliveryWorkResolution,
	type: SliceWorkState['type'],
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult | null {
	const candidate = candidates.find((entry) => entry.state.type === type)

	return candidate === undefined ? null : handleSliceWorkState(context, candidate.slice, candidate.state, resolution)
}

function handleFirstExecutableSlice(
	context: ResolvedDeliveryHandlerContext,
	candidates: SliceStateCandidate[],
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const executable = candidates.find((candidate) => candidate.state.type === 'executable')

	return executable === undefined ? noEligibleWork() : handleSliceWorkState(context, executable.slice, executable.state, resolution)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSelectableModel, seedSlice, stamp, validationEvidence } =
		await import('../../../utils/test-helpers')

	describe('handleDeliverySlicesIncomplete', () => {
		it('claims the first executable Slice in Delivery slice order', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-blocked', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			options.tx.links.records.set('dependency-1', {
				id: 'dependency-1',
				type: 'depends-on',
				from: { type: 'slice', id: 'slice-blocked' },
				to: { type: 'slice', id: 'slice-executable' },
				created: stamp,
				archivePeriods: [],
			})
			seedSliceArtifact(options.tx, 'slice-blocked')
			seedSliceArtifact(options.tx, 'slice-executable')

			const result = await handleDeliverySlicesIncomplete(await handlerContext(options))

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.agentRuns.records.get('agent-run-1')?.purpose).toEqual({
				type: 'execution',
				deliveryId: 'delivery-1',
				sliceId: 'slice-executable',
				mode: { type: 'initial' },
			})
		})

		it('validates the first Slice needing delivery validation before artifact validation or executable Slice work', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-delivery-validation', 'delivery-1')
			seedSlice(options.tx, 'slice-artifact-validation', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-delivery-validation')
			seedSliceArtifact(options.tx, 'slice-artifact-validation')
			seedSliceArtifact(options.tx, 'slice-executable')
			seedPromotion(options.tx, 'slice-delivery-validation')
			seedCompletedSliceExecution(options.tx, 'slice-artifact-validation')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 1, failures: [] },
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'validate-slice-delivery-artifact',
				sliceId: 'slice-delivery-validation',
				evidence: validationEvidence('delivery-branch-validation', true, 'No Slice Delivery Artifact validation is configured.'),
			})
			expect(options.tx.agentRuns.records.has('agent-run-1')).toBe(false)
		})

		it('validates the first Slice needing artifact validation before claiming executable Slice work', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-active', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-active')
			seedSliceArtifact(options.tx, 'slice-executable')
			seedCompletedSliceExecution(options.tx, 'slice-active')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 1, failures: [] },
			})
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'validate-slice-artifact',
				sliceId: 'slice-active',
				evidence: validationEvidence('slice-branch-validation', true, 'No Slice Artifact validation is configured.'),
			})
			expect(options.tx.agentRuns.records.has('agent-run-1')).toBe(false)
		})

		it('returns no-eligible-work when no Slice is executable', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 0, failures: [] },
			})
		})
	})

	async function handlerContext(options: ReturnType<typeof executableDeliveryFixture>): Promise<ResolvedDeliveryHandlerContext> {
		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')
		const workResolution = await resolveDeliveryWork(options.tx, deliveryContext.value)
		if (!workResolution.ok || workResolution.value.type !== 'passed') throw new Error('Expected Delivery Work Resolution.')

		return {
			services: options,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
			workResolution: workResolution.value.resolution,
		}
	}

	function executableDeliveryFixture(options: { portfolioConfig?: boolean; workConfig?: boolean } = {}) {
		const core = createTestCoreServices()
		seedSelectableModel(core.tx, 'model-1')
		seedProject(core.tx, 'project-1')
		seedDelivery(core.tx, 'delivery-1')
		seedQueuedDelivery(core.tx)
		seedDeliveryArtifact(core.tx)
		if (options.portfolioConfig !== false) seedPortfolioConfig(core.tx, options.workConfig !== false)

		return core
	}

	function seedPortfolioConfig(tx: ReturnType<typeof executableDeliveryFixture>['tx'], includeWorkConfig: boolean) {
		tx.portfolioConfig.record = {
			configured: localStamp(),
			value: {
				model: {
					defaultModelId: 'model-1',
					planningModelId: null,
					revisionPlanningModelId: null,
					executionModelId: null,
					revisionExecutionModelId: null,
				},
				work: includeWorkConfig ? { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 } : null,
			},
		}
	}

	function seedQueuedDelivery(tx: ReturnType<typeof executableDeliveryFixture>['tx']) {
		tx.deliveries.records.get('delivery-1')!.queued = localStamp()
	}

	function seedDeliveryArtifact(tx: ReturnType<typeof executableDeliveryFixture>['tx']) {
		tx.deliveryArtifacts.records.set('delivery-artifact-1', {
			id: 'delivery-artifact-1',
			deliveryId: 'delivery-1',
			config: { type: 'source-control', deliveryBranch: 'delivery' },
			created: stamp,
		})
	}

	function seedSliceArtifact(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.sliceArtifacts.records.set(`${sliceId}-artifact`, {
			id: `${sliceId}-artifact`,
			sliceId,
			config: { type: 'source-control', sliceBranch: `${sliceId}-branch` },
			created: stamp,
		})
	}

	function seedPromotion(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.actions.records.set('promote-slice', {
			id: 'promote-slice',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T11:20:00.000Z' },
			authorized: null,
			result: {
				type: 'promote-slice-artifact',
				sliceId,
				evidence: {
					type: 'external-operation',
					operation: { type: 'merge-review-surface' },
					passed: true,
					summary: 'Merged.',
				},
			},
		})
	}

	function seedCompletedSliceExecution(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.agentRuns.records.set('agent-run-active', {
			id: 'agent-run-active',
			agent: { type: 'model', modelId: 'model-1' },
			purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId, mode: { type: 'initial' } },
			started: { at: '2026-06-10T11:30:00.000Z' },
			completed: { at: '2026-06-10T11:40:00.000Z' },
		})
	}
}
