import type { Slice, SliceWorkState } from '../../../domain/slice'
import { appendAgentRunEvent, createModelAgentRunAndRequestPreparation } from '../../../utils/agent-runs'
import { requestAgentRunModelTurn } from '../../../utils/dispatch'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { CoreTransaction } from '../../../utils/transactions'
import type { DeliveryHandlerContext, DeliveryWorkHandlerResult, DeliveryWorkResolution } from '../../delivery-work/types'

export async function handleSliceExecutable(
	context: DeliveryHandlerContext,
	slice: Slice,
	state: Extract<SliceWorkState, { type: 'executable' }>,
	resolution: DeliveryWorkResolution,
	transaction: CoreTransaction,
): Promise<DeliveryWorkHandlerResult> {
	const agentRunId = nextId(context.values)
	if (!agentRunId.ok) return agentRunId

	const started = runtimeRecord(context.values)
	if (!started.ok) return started

	const created = await createModelAgentRunAndRequestPreparation(
		{ values: context.values, dispatch: transaction.dispatch, notifications: transaction.notifications },
		transaction.storage,
		{
			agentRunId: agentRunId.value,
			agentRunProfile: resolution.executionProfile,
			project: context.deliveryContext.project,
			purpose: {
				type: 'execution',
				deliveryId: context.deliveryContext.delivery.id,
				sliceId: slice.id,
				mode:
					state.mode === 'initial'
						? { type: 'initial' }
						: { type: 'correction', failureChainRootActionId: state.failureChain.rootActionId },
			},
			started: started.value,
		},
	)
	if (!created.ok) return created

	const input = await appendAgentRunEvent(
		{ values: context.values, notifications: transaction.notifications },
		transaction.storage,
		created.value.agentRun.id,
		{
			type: 'input-message',
			source: { type: 'runtime' },
			parts: [{ type: 'text', text: slice.instruction.body, metadata: null }],
		},
	)
	if (!input.ok) return input

	const modelTurnRequested = await requestAgentRunModelTurn(transaction.dispatch, created.value.agentRun.id, input.value.id)
	return modelTurnRequested.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : modelTurnRequested
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
			const result = await context.services.transactions.run((transaction) =>
				handleSliceExecutable(
					{ ...context, storage: transaction.storage },
					context.tx.slices.records.get('01k00000000000000000000042')!,
					{ type: 'executable', mode: 'initial' },
					resolution,
					transaction,
				),
			)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
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
				instruction: { type: 'source-control-execution', version: 1 },
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
			const result = await context.services.transactions.run((transaction) =>
				handleSliceExecutable(
					{ ...context, storage: transaction.storage },
					context.tx.slices.records.get('01k00000000000000000000042')!,
					{
						type: 'executable',
						mode: 'correction',
						failureChain: { rootActionId: '01k00000000000000000010020', correctionRetries: 1 },
					},
					resolution,
					transaction,
				),
			)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
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

		return {
			services: options,
			storage: options.tx,
			values: options.values,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
		}
	}
}
