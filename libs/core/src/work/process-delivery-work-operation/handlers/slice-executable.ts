import { acceptAgentRunModelTurn, acceptAgentRunSandboxPreparation } from '../../../commands/utils/dispatch'
import type { AgentRun, AgentRunProfileSnapshot, ExecutionMode } from '../../../domain/agent-run'
import type { Id, RuntimeRecord } from '../../../domain/commons'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { appendAgentRunEvent, createModelAgentRunWithProfileSnapshot } from '../../../utils/agent-run-events'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, DeliveryWorkResolution, DeliveryWorkHandlerResult } from '../../delivery-work/types'

export async function handleSliceExecutable(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): Promise<DeliveryWorkHandlerResult> {
	const agentRun = sliceExecutionAgentRun(context, slice, state, resolution)
	if (!agentRun.ok) return agentRun

	return writeSliceExecutionAgentRun(context, agentRun.value)
}

interface SliceExecutionAgentRunInput {
	agentRunId: Id
	purpose: Extract<AgentRun['purpose'], { type: 'execution' }>
	started: RuntimeRecord
	profile: AgentRunProfileSnapshot
}

async function writeSliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	agentRun: SliceExecutionAgentRunInput,
): Promise<DeliveryWorkHandlerResult> {
	const agentRunPut = await createModelAgentRunWithProfileSnapshot(context.storage, agentRun)
	if (!agentRunPut.ok) return agentRunPut

	const input = await appendAgentRunEvent({ values: context.values }, context.storage, agentRunPut.value.id, {
		type: 'input-message',
		source: { type: 'runtime' },
		parts: [{ type: 'text', text: `Execute Slice ${agentRun.purpose.sliceId}.`, metadata: null }],
	})
	if (!input.ok) return input

	const preparationMarker = await acceptAgentRunSandboxPreparation(context.services.dispatcher, agentRunPut.value.id, {
		type: 'agent-run-created',
	})
	if (!preparationMarker.ok) return preparationMarker

	const modelTurnMarker = await acceptAgentRunModelTurn(context.services.dispatcher, agentRunPut.value.id, input.value.id)
	if (!modelTurnMarker.ok) return modelTurnMarker

	return { ok: true, value: { processedCount: 1, failures: [], dispatchMarkers: [preparationMarker.value, modelTurnMarker.value] } }
}

function sliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
): CoreResult<SliceExecutionAgentRunInput, DeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const agentRunId = nextId(context.values)
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
			profile: {
				agentRunProfileId: resolution.executionProfile.id,
				name: resolution.executionProfile.name,
				modelUse: resolution.executionProfile.modelUse,
				runtimeRequirements: resolution.executionProfile.runtimeRequirements,
				sandboxConfig: resolution.executionProfile.sandboxConfig,
			},
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
	const { createTestCoreServices, defaultAgentRunSandboxConfig, seedDelivery, seedSlice, seedSelectableModel } =
		await import('../../../utils/test-helpers')

	describe('handleSliceExecutable', () => {
		it('claims initial executable Slice work with a profile-snapshotted Agent Run and input event', async () => {
			const context = await executableHandlerContext()
			const result = await handleSliceExecutable(
				context,
				context.tx.slices.records.get('01k00000000000000000000042')!,
				{ type: 'executable', mode: 'initial' },
				resolution,
			)

			expect(result).toEqual({
				ok: true,
				value: { processedCount: 1, failures: [], dispatchMarkers: ['dispatch-marker', 'dispatch-marker'] },
			})
			expect(context.tx.actions.records.size).toBe(0)
			expect(context.tx.agentRuns.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				agent: { type: 'model' },
				purpose: {
					type: 'execution',
					deliveryId: '01k00000000000000000000008',
					sliceId: '01k00000000000000000000042',
					mode: { type: 'initial' },
				},
				profile: {
					agentRunProfileId: '01k00000000000000000000006',
					name: 'Execution',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
				},
				modelUseOverride: null,
				sourceRuntimeRequirements: [],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [],
				blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: {
					key: '01k00000000000000000010001',
					created: null,
					appliedRequirements: [],
					appliedThroughEventId: null,
					released: null,
				},
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})
			expect(context.tx.agentRunEvents.records.get('01k00000000000000000010002')?.body).toEqual({
				type: 'input-message',
				source: { type: 'runtime' },
				parts: [{ type: 'text', text: 'Execute Slice 01k00000000000000000000042.', metadata: null }],
			})
		})

		it('claims correction executable Slice work in correction mode', async () => {
			const context = await executableHandlerContext()
			const result = await handleSliceExecutable(
				context,
				context.tx.slices.records.get('01k00000000000000000000042')!,
				{
					type: 'executable',
					mode: 'correction',
					failureChain: { rootActionId: '01k00000000000000000010020', correctionRetries: 1 },
				},
				resolution,
			)

			expect(result).toEqual({
				ok: true,
				value: { processedCount: 1, failures: [], dispatchMarkers: ['dispatch-marker', 'dispatch-marker'] },
			})
			expect(context.tx.agentRuns.records.get('01k00000000000000000010001')?.purpose).toEqual({
				type: 'execution',
				deliveryId: '01k00000000000000000000008',
				sliceId: '01k00000000000000000000042',
				mode: { type: 'correction', failureChainRootActionId: '01k00000000000000000010020' },
			})
		})
	})

	const resolution: DeliveryWorkResolution = {
		workConfig: {
			maxProcessableSliceSlots: 1,
			maxCorrectionRetriesPerFailure: 1,
			executionAgentRunProfileId: '01k00000000000000000000006',
			revisionExecutionAgentRunProfileId: null,
		},
		executionProfile: {
			id: '01k00000000000000000000006',
			name: 'Execution',
			modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
			runtimeRequirements: [],
			sandboxConfig: defaultAgentRunSandboxConfig(),
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		},
		executionModelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
		executionModel: {
			id: '01k00000000000000000000024',
			providerId: '01k00000000000000000000027',
			name: 'Model',
			providerModelId: 'provider-model',
			providerOptions: null,
			capabilities: { inputs: ['text'], contextWindowTokens: 128000, maxOutputTokens: 16384, thinking: null },
			pricing: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		},
		executionModelProvider: {
			id: '01k00000000000000000000027',
			name: 'Provider',
			source: { type: 'anthropic' },
			auth: null,
			headers: [],
			providerOptions: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		},
	}

	async function executableHandlerContext() {
		const options = createTestCoreServices()
		seedSelectableModel(options.tx, '01k00000000000000000000024')
		seedDelivery(options.tx, '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')

		const deliveryContext = await buildDeliveryContext(options.tx, '01k00000000000000000000008')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return { services: options, storage: options.tx, values: options.values, tx: options.tx, deliveryContext: deliveryContext.value }
	}
}
