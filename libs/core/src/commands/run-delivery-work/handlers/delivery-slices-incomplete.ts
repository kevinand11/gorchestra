import { resolveDeliveryWork } from './resolution'
import { noEligibleWork, sliceCapacityFull } from './result'
import { handleSliceWorkState, isActiveSliceSlotState } from './slice'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { InvalidInputError } from '../../../errors'
import { getSliceState } from '../../../utils/delivery-context'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, DeliveryWorkResolution, Error, RunDeliveryWorkHandlerResult } from '../types'

interface SliceStateCandidate {
	slice: Slice
	state: SliceWorkState
}

export async function handleDeliverySlicesIncomplete(context: DeliveryHandlerContext): Promise<RunDeliveryWorkHandlerResult> {
	const resolution = await deliveryWorkResolution(context)
	if (!resolution.ok) return resolution

	const candidates = sliceStateCandidates(context)
	if (!candidates.ok) return candidates

	const capacityResult = capacityCheck(candidates.value, resolution.value)
	if (capacityResult !== null) return capacityResult

	return handleFirstExecutableSlice(context, candidates.value, resolution.value)
}

function deliveryWorkResolution(
	context: DeliveryHandlerContext,
): Promise<CoreResult<DeliveryWorkResolution, Exclude<Error, InvalidInputError>>> | CoreResult<DeliveryWorkResolution, never> {
	return context.preflight === undefined
		? resolveDeliveryWork(context.tx, context.deliveryContext.delivery)
		: { ok: true, value: context.preflight }
}

function sliceStateCandidates(context: DeliveryHandlerContext): CoreResult<SliceStateCandidate[], Exclude<Error, InvalidInputError>> {
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

function handleFirstExecutableSlice(
	context: DeliveryHandlerContext,
	candidates: SliceStateCandidate[],
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> | RunDeliveryWorkHandlerResult {
	const executable = candidates.find((candidate) => candidate.state.type === 'executable')

	return executable === undefined ? noEligibleWork() : handleSliceWorkState(context, executable.slice, executable.state, resolution)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildStoredDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, localStamp, seedDelivery, seedProject, seedSelectableModel, seedSlice, stamp } =
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

		it('returns slice-capacity-full when active slots meet configured capacity', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-active', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-active')
			seedSliceArtifact(options.tx, 'slice-executable')
			seedCompletedSliceExecution(options.tx, 'slice-active')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 0, failures: [] },
			})
		})

		it('returns no-eligible-work when no Slice is executable', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual({
				ok: true,
				value: { processedCount: 0, failures: [] },
			})
		})

		it('returns invariant violation when called without passing Delivery preflight and Portfolio Config is missing', async () => {
			const options = executableDeliveryFixture({ portfolioConfig: false })
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-1')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual(failedResolutionResult())
		})

		it('returns invariant violation when called without passing Delivery preflight and Delivery Work Config is unresolved', async () => {
			const options = executableDeliveryFixture({ workConfig: false })
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-1')

			expect(await handleDeliverySlicesIncomplete(await handlerContext(options))).toEqual(failedResolutionResult())
		})
	})

	async function handlerContext(options: ReturnType<typeof executableDeliveryFixture>): Promise<DeliveryHandlerContext> {
		const deliveryContext = await buildStoredDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return { services: options, tx: options.tx, deliveryContext: deliveryContext.value }
	}

	function errorResult(error: unknown) {
		return { ok: false, error }
	}

	function failedResolutionResult() {
		return errorResult({ type: 'invariant-violation', message: 'Delivery work resolution requires passing Delivery preflight.' })
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
		tx.actions.records.set('queue-delivery', {
			id: 'queue-delivery',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T11:00:00.000Z' },
			authorized: localStamp(),
			result: { type: 'queue-delivery' },
		})
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
