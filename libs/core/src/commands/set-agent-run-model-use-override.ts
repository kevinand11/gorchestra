import { v, type PipeOutput } from 'valleyed'

import type { AgentRunEvent } from '../domain/agent-run-event'
import { idPipe } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ResourceArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CommandContext } from './types'
import { requireInteractiveAgentRunOpen } from '../utils/agent-run-targets'
import { appendAgentRunEvent, updateAgentRunRecord } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import {
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	validateModelUseConfigs,
	withAuditStampTransaction,
} from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const setAgentRunModelUseOverrideInputPipe = v.object({ agentRunId: idPipe, modelUse: v.nullable(modelUseConfigPipe) })
export type Input = PipeOutput<typeof setAgentRunModelUseOverrideInputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ResourceArchivedError
	| ModelThinkingLevelUnavailableError
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSetAgentRunModelUseOverrideCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setAgentRunModelUseOverride', setAgentRunModelUseOverrideInputPipe, (input, context) =>
		withAuditStampTransaction<Result, Exclude<Error, InvalidInputError>>(runtime, context, async (storage, stamp, notifications) => {
			const agentRun = await requireInteractiveAgentRunOpen(storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			if (input.modelUse !== null) {
				const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([input.modelUse]))
				if (!facts.ok) return facts

				const modelUseValidation = validateModelUseConfigs(facts.value, [input.modelUse])
				if (!modelUseValidation.ok) return modelUseValidation
			}

			const updated = await updateAgentRunRecord(storage, notifications, input.agentRunId, {
				modelUseOverride: input.modelUse === null ? null : { modelUse: input.modelUse, selected: stamp },
			})
			if (!updated.ok) return updated

			return appendAgentRunEvent({ values: runtime.values, notifications }, storage, input.agentRunId, {
				type: 'agent-run-model-use-override-changed',
				modelUse: input.modelUse,
				authorized: stamp,
			})
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp, seedSelectableModel } = await import('../utils/test-helpers')
	const { planningAgentRunFixture } = await import('../utils/agent-run-test-utils')

	describe('setAgentRunModelUseOverride command', () => {
		it('sets a model-use override for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, '01k00000000000000000000026')
			const command = createSetAgentRunModelUseOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					agentRunId: '01k00000000000000000000002',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'agent-run-model-use-override-changed',
						modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' },
						authorized: localStamp(),
					},
				},
			})
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.modelUseOverride).toEqual({
				modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' },
				selected: localStamp(),
			})
		})

		it('clears a model-use override', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.modelUseOverride = {
				modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
				selected: localStamp(),
			}
			const command = createSetAgentRunModelUseOverrideCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: '01k00000000000000000000002', modelUse: null }, context)

			expect(result).toMatchObject({ ok: true, value: { body: { type: 'agent-run-model-use-override-changed', modelUse: null } } })
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.modelUseOverride).toBeNull()
		})

		it('validates selectable models', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, '01k00000000000000000000026', { modelArchived: true })
			const command = createSetAgentRunModelUseOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' } },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'model', id: '01k00000000000000000000026' },
			})
		})

		it('rejects Autonomous Agent Runs', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, '01k00000000000000000000026')
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.purpose = {
				type: 'execution',
				deliveryId: '01k00000000000000000000008',
				sliceId: '01k00000000000000000000042',
				mode: { type: 'initial' },
			}
			const command = createSetAgentRunModelUseOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' } },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: '01k00000000000000000000002' } })
		})
	})
}
