import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp } from '../domain/commons'
import { modelUseConfigPipe } from '../domain/config'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	ArchivedAgentRunProfileReferenceError,
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	PlanClosedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { requireInteractiveAgentRunTargetOpen } from '../utils/agent-run-targets'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import {
	loadSelectableModelFacts,
	modelIdsFromModelUses,
	updateRecordValue,
	validateModelUseConfigs,
	withAuditStampTransaction,
} from './utils/storage'

const setAgentRunModelUseOverrideInputPipe = v.object({ agentRunId: idPipe, modelUse: v.nullable(modelUseConfigPipe) })
export type Input = PipeOutput<typeof setAgentRunModelUseOverrideInputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ArchivedModelReferenceError
	| ArchivedModelProviderReferenceError
	| ArchivedAgentRunProfileReferenceError
	| ModelThinkingLevelUnavailableError
	| PlanClosedError
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSetAgentRunModelUseOverrideCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setAgentRunModelUseOverride', setAgentRunModelUseOverrideInputPipe, (input, context) =>
		withAuditStampTransaction(runtime, context, (storage, stamp) => setAgentRunModelUseOverride(runtime, storage, input, stamp)),
	)
}

async function setAgentRunModelUseOverride(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const agentRun = await requireInteractiveAgentRunTargetOpen(storage, input.agentRunId)
	if (!agentRun.ok) return agentRun

	if (input.modelUse !== null) {
		const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([input.modelUse]))
		if (!facts.ok) return facts

		const modelUseValidation = validateModelUseConfigs(facts.value, [input.modelUse])
		if (!modelUseValidation.ok) return modelUseValidation
	}

	const updated = await updateRecordValue('agent-run', storage, input.agentRunId, {
		modelUseOverride: input.modelUse === null ? null : { modelUse: input.modelUse, selected: stamp },
	})
	if (!updated.ok) return updated

	return appendAgentRunEvent(runtime, storage, input.agentRunId, {
		type: 'agent-run-model-use-override-changed',
		modelUse: input.modelUse,
		authorized: stamp,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp, seedSelectableModel } = await import('../utils/test-helpers')
	const { planningAgentRunFixture, revisionPlanningAgentRunFixture } = await import('./utils/agent-run-test-utils')

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

			expect(result).toEqual({ ok: false, error: { type: 'archived-model-reference', modelId: '01k00000000000000000000026' } })
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

		it('rejects revision-planning Agent Runs whose Revision Gate is closed', async () => {
			const options = revisionPlanningAgentRunFixture(true)
			seedSelectableModel(options.tx, '01k00000000000000000000026')
			const command = createSetAgentRunModelUseOverrideCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', modelUse: { modelId: '01k00000000000000000000026', thinkingLevel: 'none' } },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: '01k00000000000000000000002' } })
		})
	})
}
