import type { AgentRun, ExecutionMode } from '../../../domain/agent-run'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { nextId, putRecord, runtimeRecord } from '../../../utils/command-storage'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, DeliveryWorkResolution, RunDeliveryWorkHandlerResult } from '../types'

export async function handleSliceExecutable(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> {
	const agentRun = sliceExecutionAgentRun(context, slice, state, resolution)
	if (!agentRun.ok) return agentRun

	return writeSliceExecutionAgentRun(context, agentRun.value)
}

async function writeSliceExecutionAgentRun(context: DeliveryHandlerContext, agentRun: AgentRun): Promise<RunDeliveryWorkHandlerResult> {
	const agentRunPut = await putRecord('agent-run', context.tx.agentRuns, agentRun.id, agentRun)
	if (!agentRunPut.ok) return agentRunPut

	return { ok: true, value: { processedCount: 1, failures: [] } }
}

function sliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): CoreResult<AgentRun, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const agentRunId = nextId(context.services, 'agent-run')
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(context.services)
	if (!started.ok) return started

	return {
		ok: true,
		value: executionAgentRun(
			agentRunId.value,
			resolution.executionModel.id,
			context.deliveryContext.delivery.id,
			slice.id,
			executionModeForState(state),
			started.value,
		),
	}
}

function executionModeForState(state: Extract<SliceWorkState, { type: 'executable' }>): ExecutionMode {
	return state.mode === 'initial'
		? { type: 'initial' }
		: { type: 'correction', failureChainRootActionId: state.failureChain.rootActionId }
}

function executionAgentRun(
	agentRunId: string,
	modelId: string,
	deliveryId: string,
	sliceId: string,
	mode: ExecutionMode,
	started: AgentRun['started'],
): AgentRun {
	return {
		id: agentRunId,
		agent: { type: 'model', modelId },
		purpose: { type: 'execution', deliveryId, sliceId, mode },
		started,
		completed: null,
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildStoredDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, seedSelectableModel } = await import('../../../utils/test-helpers')

	describe('handleSliceExecutable', () => {
		it('claims initial executable Slice work with an Agent Run', async () => {
			const context = await executableHandlerContext()
			const result = await handleSliceExecutable(
				context,
				context.tx.slices.records.get('slice-1')!,
				{ type: 'executable', mode: 'initial' },
				resolution,
			)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.actions.records.size).toBe(0)
			expect(context.tx.agentRuns.records.get('agent-run-1')).toEqual({
				id: 'agent-run-1',
				agent: { type: 'model', modelId: 'model-1' },
				purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})
		})

		it('claims correction executable Slice work in correction mode', async () => {
			const context = await executableHandlerContext()
			const result = await handleSliceExecutable(
				context,
				context.tx.slices.records.get('slice-1')!,
				{
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: 'failed-validation', correctionRetries: 1 },
				},
				resolution,
			)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.agentRuns.records.get('agent-run-1')?.purpose).toEqual({
				type: 'execution',
				deliveryId: 'delivery-1',
				sliceId: 'slice-1',
				mode: { type: 'correction', failureChainRootActionId: 'failed-validation' },
			})
		})
	})

	const resolution: DeliveryWorkResolution = {
		workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
		executionModel: {
			id: 'model-1',
			providerId: 'model-provider-1',
			name: 'Model',
			providerModelId: 'provider-model',
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		},
		executionModelProvider: {
			id: 'model-provider-1',
			name: 'Provider',
			protocol: 'anthropic-messages',
			baseUrl: 'https://api.anthropic.com',
			auth: null,
			headers: [],
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		},
	}

	async function executableHandlerContext() {
		const options = createTestCoreServices()
		seedSelectableModel(options.tx, 'model-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')

		const deliveryContext = await buildStoredDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return { services: options, tx: options.tx, deliveryContext: deliveryContext.value }
	}
}
