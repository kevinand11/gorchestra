import { resolveDeliveryWork } from './resolution'
import { noEligibleWork, sliceCapacityFull } from './result'
import { handleSliceWorkState, isActiveSliceSlotState } from './slice'
import { slicePipe, type Slice, type SliceWorkState } from '../../../domain/slice'
import type { InvalidInputError } from '../../../errors'
import { listRecords } from '../../../utils/storage'
import type { Result as CoreResult } from '../../../utils/types'
import { deriveSliceWorkState } from '../../../utils/work-state'
import type { DeliveryHandlerContext, DeliveryWorkResolution, Error, RunDeliveryWorkHandlerResult } from '../types'

interface SliceStateCandidate {
	slice: Slice
	state: SliceWorkState
}

export async function handleDeliverySlicesIncomplete(context: DeliveryHandlerContext): Promise<RunDeliveryWorkHandlerResult> {
	const resolution = await resolveDeliveryWork(context.tx, context.delivery)
	if (!resolution.ok) return resolution

	const candidates = await sliceStateCandidates(context)
	if (!candidates.ok) return candidates

	const capacityResult = capacityCheck(candidates.value, resolution.value)
	if (capacityResult !== null) return capacityResult

	return handleFirstExecutableSlice(context, candidates.value, resolution.value)
}

async function sliceStateCandidates(
	context: DeliveryHandlerContext,
): Promise<CoreResult<SliceStateCandidate[], Exclude<Error, InvalidInputError>>> {
	const slices = await deliverySlices(context)
	if (!slices.ok) return slices

	const candidates: SliceStateCandidate[] = []
	for (const slice of slices.value) {
		const stateResult = await deriveSliceWorkState(context.tx, slice.id)
		if (!stateResult.ok) return stateResult
		candidates.push({ slice, state: stateResult.value })
	}

	return { ok: true, value: candidates }
}

async function deliverySlices(context: DeliveryHandlerContext): Promise<CoreResult<Slice[], Exclude<Error, InvalidInputError>>> {
	const slices = await listRecords('slice', context.tx.slices, slicePipe)
	if (!slices.ok) return slices

	return {
		ok: true,
		value: slices.value
			.filter((slice) => slice.deliveryId === context.delivery.id)
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
	}
}

function capacityCheck(candidates: SliceStateCandidate[], resolution: DeliveryWorkResolution): RunDeliveryWorkHandlerResult | null {
	const activeSlots = candidates.filter((candidate) => isActiveSliceSlotState(candidate.state)).length

	return activeSlots >= resolution.workConfig.maxActiveSliceSlots
		? sliceCapacityFull(activeSlots, resolution.workConfig.maxActiveSliceSlots)
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
	const { createTestOpenCoreOptions, localStamp, seedDelivery, seedProject, seedSelectableModel, seedSlice, stamp } =
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

			const result = await handleDeliverySlicesIncomplete(handlerContext(options))

			expect(result).toEqual({ ok: true, value: { type: 'worked', actionIds: ['action-1'], agentRunIds: ['agent-run-1'] } })
			expect(options.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'start-slice-execution',
				sliceId: 'slice-executable',
				mode: 'initial',
				agentRunId: 'agent-run-1',
			})
		})

		it('returns slice-capacity-full when active slots meet configured capacity', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-active', 'delivery-1')
			seedSlice(options.tx, 'slice-executable', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-active')
			seedSliceArtifact(options.tx, 'slice-executable')
			seedStartSliceExecution(options.tx, 'slice-active')

			expect(await handleDeliverySlicesIncomplete(handlerContext(options))).toEqual({
				ok: true,
				value: { type: 'no-op', reason: { type: 'slice-capacity-full', activeSlots: 1, maxActiveSliceSlots: 1 } },
			})
		})

		it('returns no-eligible-work when no Slice is executable', async () => {
			const options = executableDeliveryFixture()
			seedSlice(options.tx, 'slice-1', 'delivery-1')

			expect(await handleDeliverySlicesIncomplete(handlerContext(options))).toEqual({
				ok: true,
				value: { type: 'no-op', reason: { type: 'no-eligible-work' } },
			})
		})

		it('returns not-found-singleton when Portfolio Config is missing', async () => {
			const options = executableDeliveryFixture({ portfolioConfig: false })
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-1')

			expect(await handleDeliverySlicesIncomplete(handlerContext(options))).toEqual(
				errorResult({ type: 'not-found-singleton', resource: 'portfolio-config' }),
			)
		})

		it('returns not-implemented when effective Delivery Work Config is unresolved', async () => {
			const options = executableDeliveryFixture({ workConfig: false })
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			seedSliceArtifact(options.tx, 'slice-1')

			expect(await handleDeliverySlicesIncomplete(handlerContext(options))).toEqual(
				errorResult({ type: 'not-implemented', operation: 'runDeliveryWork.delivery-work-config-unresolved' }),
			)
		})
	})

	function handlerContext(options: ReturnType<typeof executableDeliveryFixture>): DeliveryHandlerContext {
		return { options, tx: options.tx, delivery: options.tx.deliveries.records.get('delivery-1')! }
	}

	function errorResult(error: unknown) {
		return { ok: false, error }
	}

	function executableDeliveryFixture(options: { portfolioConfig?: boolean; workConfig?: boolean } = {}) {
		const core = createTestOpenCoreOptions()
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
				work: includeWorkConfig ? { maxActiveSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 } : null,
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

	function seedStartSliceExecution(tx: ReturnType<typeof executableDeliveryFixture>['tx'], sliceId: string) {
		tx.agentRuns.records.set('agent-run-active', {
			id: 'agent-run-active',
			agent: { type: 'model', modelId: 'model-1' },
			purpose: { type: 'execution', actionId: 'start-active' },
			started: { at: '2026-06-10T11:30:00.000Z' },
			completed: null,
		})
		tx.actions.records.set('start-active', {
			id: 'start-active',
			deliveryId: 'delivery-1',
			performed: { at: '2026-06-10T11:30:00.000Z' },
			authorized: null,
			result: { type: 'start-slice-execution', sliceId, mode: 'initial', agentRunId: 'agent-run-active' },
		})
	}
}
