import type { AgentRun, ExecutionMode } from '../../../domain/agent-run'
import type { Id, RuntimeRecord } from '../../../domain/commons'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { appendAgentRunEvent, createModelAgentRunWithInitialModel } from '../../../utils/agent-run-events'
import type { Result as CoreResult } from '../../../utils/types'
import { nextId, runtimeRecord } from '../../utils/storage'
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

interface SliceExecutionAgentRunInput {
	agentRunId: Id
	purpose: Extract<AgentRun['purpose'], { type: 'execution' }>
	started: RuntimeRecord
	modelId: Id
}

async function writeSliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	agentRun: SliceExecutionAgentRunInput,
): Promise<RunDeliveryWorkHandlerResult> {
	const agentRunPut = await createModelAgentRunWithInitialModel({ values: context.values }, context.storage, agentRun)
	if (!agentRunPut.ok) return agentRunPut

	const input = await appendAgentRunEvent({ values: context.values }, context.storage, agentRunPut.value.id, {
		type: 'input-message',
		source: { type: 'runtime' },
		content: [{ type: 'text', text: `Execute Slice ${agentRun.purpose.sliceId}.` }],
	})
	if (!input.ok) return input

	return { ok: true, value: { processedCount: 1, failures: [] } }
}

function sliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): CoreResult<SliceExecutionAgentRunInput, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const agentRunId = nextId(context.values, 'agent-run')
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(context.values)
	if (!started.ok) return started

	return {
		ok: true,
		value: {
			agentRunId: agentRunId.value,
			purpose: {
				type: 'execution',
				deliveryId: context.deliveryContext.delivery.id,
				sliceId: slice.id,
				mode: executionModeForState(state),
			},
			started: started.value,
			modelId: resolution.executionModel.id,
		},
	}
}

function executionModeForState(state: Extract<SliceWorkState, { type: 'executable' }>): ExecutionMode {
	return state.mode === 'initial'
		? { type: 'initial' }
		: { type: 'correction', failureChainRootActionId: state.failureChain.rootActionId }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, seedDelivery, seedSlice, seedSelectableModel } = await import('../../../utils/test-helpers')

	describe('handleSliceExecutable', () => {
		it('claims initial executable Slice work with an Agent Run and initial model selection event', async () => {
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
				agent: { type: 'model' },
				purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})
			expect(context.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toEqual({
				type: 'agent-run-model-selected',
				modelId: 'model-1',
				modelProviderId: 'model-1-provider',
				protocol: 'anthropic-messages',
				authorized: null,
			})
			expect(context.tx.agentRunEvents.records.get('agent-run-event-2')?.body).toEqual({
				type: 'input-message',
				source: { type: 'runtime' },
				content: [{ type: 'text', text: 'Execute Slice slice-1.' }],
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

		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return { services: options, storage: options.tx, values: options.values, tx: options.tx, deliveryContext: deliveryContext.value }
	}
}
