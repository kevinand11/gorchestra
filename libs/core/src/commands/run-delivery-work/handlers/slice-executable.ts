import type { Action } from '../../../domain/action'
import type { AgentRun } from '../../../domain/agent-run'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import type { Result as CoreResult } from '../../../utils/types'
import { nextId, putRecord, runtimeRecord } from '../../storage-utils'
import type { DeliveryHandlerContext, DeliveryWorkResolution, RunDeliveryWorkHandlerResult } from '../types'
import { worked } from './result'

export async function handleSliceExecutable(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): Promise<RunDeliveryWorkHandlerResult> {
	const records = sliceExecutionRecords(context, slice, state, resolution)
	if (!records.ok) return records

	return writeSliceExecutionRecords(context, records.value)
}

async function writeSliceExecutionRecords(
	context: DeliveryHandlerContext,
	records: { action: Action; agentRun: AgentRun },
): Promise<RunDeliveryWorkHandlerResult> {
	const actionPut = await putRecord('action', context.tx.actions, records.action.id, records.action)
	if (!actionPut.ok) return actionPut

	const agentRunPut = await putRecord('agent-run', context.tx.agentRuns, records.agentRun.id, records.agentRun)
	if (!agentRunPut.ok) return agentRunPut

	return worked(records.action.id, records.agentRun.id)
}

function sliceExecutionRecords(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): CoreResult<
	{ action: Action; agentRun: AgentRun },
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const actionId = nextId(context.options, 'action')
	if (!actionId.ok) return actionId

	const agentRunId = nextId(context.options, 'agent-run')
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(context.options)
	if (!started.ok) return started

	return {
		ok: true,
		value: {
			action: startSliceExecutionAction(context.delivery.id, slice.id, state.mode, actionId.value, agentRunId.value, started.value),
			agentRun: executionAgentRun(agentRunId.value, resolution.modelId, actionId.value, started.value),
		},
	}
}

function startSliceExecutionAction(
	deliveryId: string,
	sliceId: string,
	mode: 'initial' | 'correction',
	actionId: string,
	agentRunId: string,
	performed: Action['performed'],
): Action {
	return {
		id: actionId,
		deliveryId,
		performed,
		authorized: null,
		result: { type: 'start-slice-execution', sliceId, mode, agentRunId },
	}
}

function executionAgentRun(agentRunId: string, modelId: string, actionId: string, started: AgentRun['started']): AgentRun {
	return {
		id: agentRunId,
		agent: { type: 'model', modelId },
		purpose: { type: 'execution', actionId },
		started,
		completed: null,
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions, seedDelivery, seedSlice, seedSelectableModel } = await import('../../test-utils')

	describe('handleSliceExecutable', () => {
		it('claims initial executable Slice work with an Agent Run and start-slice-execution Action', async () => {
			const context = executableHandlerContext()
			const result = await handleSliceExecutable(
				context,
				context.tx.slices.records.get('slice-1')!,
				{ type: 'executable', mode: 'initial' },
				resolution,
			)

			expect(result).toEqual({ ok: true, value: { type: 'worked', actionIds: ['action-1'], agentRunIds: ['agent-run-1'] } })
			expect(context.tx.actions.records.get('action-1')).toEqual({
				id: 'action-1',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T12:00:00.000Z' },
				authorized: null,
				result: { type: 'start-slice-execution', sliceId: 'slice-1', mode: 'initial', agentRunId: 'agent-run-1' },
			})
			expect(context.tx.agentRuns.records.get('agent-run-1')).toEqual({
				id: 'agent-run-1',
				agent: { type: 'model', modelId: 'model-1' },
				purpose: { type: 'execution', actionId: 'action-1' },
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})
		})

		it('claims correction executable Slice work in correction mode', async () => {
			const context = executableHandlerContext()
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

			expect(result).toEqual({ ok: true, value: { type: 'worked', actionIds: ['action-1'], agentRunIds: ['agent-run-1'] } })
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'start-slice-execution',
				sliceId: 'slice-1',
				mode: 'correction',
				agentRunId: 'agent-run-1',
			})
		})
	})

	const resolution: DeliveryWorkResolution = {
		modelId: 'model-1',
		workConfig: { maxActiveSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
	}

	function executableHandlerContext() {
		const options = createTestOpenCoreOptions()
		seedSelectableModel(options.tx, 'model-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSlice(options.tx, 'slice-1', 'delivery-1')

		return { options, tx: options.tx, delivery: options.tx.deliveries.records.get('delivery-1')! }
	}
}
