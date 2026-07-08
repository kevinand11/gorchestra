import { acceptAgentRunModelTurn } from '../../../commands/utils/dispatch'
import type { AgentRun, AgentRunProfileSnapshot, ExecutionMode } from '../../../domain/agent-run'
import type { Id, RuntimeRecord } from '../../../domain/commons'
import type { Slice, SliceWorkState } from '../../../domain/slice'
import { sourceControlSliceExecutionInstruction } from '../../../runtime/agent-runs/instructions'
import { appendAgentRunEvent, createInstructedModelAgentRunAndRequestPreparation } from '../../../utils/agent-runs'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult, DeliveryWorkResolution } from '../../delivery-work/types'

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
	initialInputText: string
}

async function writeSliceExecutionAgentRun(
	context: DeliveryHandlerContext,
	agentRun: SliceExecutionAgentRunInput,
): Promise<DeliveryWorkHandlerResult> {
	const created = await createInstructedModelAgentRunAndRequestPreparation(
		{ values: context.values, dispatcher: context.services.dispatcher },
		context.storage,
		{
			agentRunId: agentRun.agentRunId,
			purpose: agentRun.purpose,
			started: agentRun.started,
			profile: agentRun.profile,
			instruction: sourceControlSliceExecutionInstruction(),
		},
	)
	if (!created.ok) return created

	const input = await appendAgentRunEvent({ values: context.values }, context.storage, created.value.agentRun.id, {
		type: 'input-message',
		source: { type: 'runtime' },
		parts: [{ type: 'text', text: agentRun.initialInputText, metadata: null }],
	})
	if (!input.ok) return input

	const modelTurnMarker = await acceptAgentRunModelTurn(context.services.dispatcher, created.value.agentRun.id, input.value.id)
	if (!modelTurnMarker.ok) return modelTurnMarker

	return {
		ok: true,
		value: { processedCount: 1, failures: [], dispatchMarkers: [created.value.preparationDispatchMarker, modelTurnMarker.value] },
	}
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
			initialInputText: slice.instruction.body,
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
	const { ensureGitRequirement, globalRuntimeRequirements } = await import('../../../utils/agent-run-runtime-requirements')

	describe('handleSliceExecutable', () => {
		it('claims initial executable Slice work with an instructed Agent Run and Slice instruction input event', async () => {
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
				toolSet: toolSet(['read', 'grep', 'find', 'ls', 'sh', 'edit', 'write']),
				modelUseOverride: null,
				sourceRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
				blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: null,
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})
			expect(context.tx.agentRunEvents.records.get('01k00000000000000000010002')?.body).toEqual({
				type: 'instruction-snapshot',
				instruction: { type: 'source-control-slice-execution', version: 1 },
				parts: [
					{
						type: 'text',
						text: 'Execute the accepted Slice instruction provided in runtime input.',
						metadata: null,
					},
				],
			})
			expect(context.tx.agentRunEvents.records.get('01k00000000000000000010003')?.body).toEqual({
				type: 'input-message',
				source: { type: 'runtime' },
				parts: [{ type: 'text', text: 'Do work.', metadata: null }],
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

	function toolSet(names: string[]) {
		return names.map((name) => ({ name, contractVersion: 1 }))
	}

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
