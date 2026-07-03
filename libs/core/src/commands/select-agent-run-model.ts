import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { idPipe, type AuditStamp } from '../domain/commons'
import { modelThinkingLevelPipe } from '../domain/model'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
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
import { loadSelectableModelFacts, validateModelUseConfigs, withAuditStampTransaction } from './utils/storage'

const selectAgentRunModelInputPipe = v.object({ agentRunId: idPipe, modelId: idPipe, thinkingLevel: modelThinkingLevelPipe })
export type Input = PipeOutput<typeof selectAgentRunModelInputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| ArchivedModelReferenceError
	| ArchivedModelProviderReferenceError
	| ModelThinkingLevelUnavailableError
	| PlanClosedError
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createSelectAgentRunModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('selectAgentRunModel', selectAgentRunModelInputPipe, (input, context) =>
		withAuditStampTransaction(runtime, context, (storage, stamp) => selectAgentRunModel(runtime, storage, input, stamp)),
	)
}

async function selectAgentRunModel(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const agentRun = await requireInteractiveAgentRunTargetOpen(storage, input.agentRunId)
	return agentRun.ok ? appendSelectedAgentRunModel(runtime, storage, input, stamp) : agentRun
}

async function appendSelectedAgentRunModel(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const facts = await loadSelectableModelFacts(storage, [input.modelId])
	if (!facts.ok) return facts

	const modelUseValidation = validateModelUseConfigs(facts.value, [{ modelId: input.modelId, thinkingLevel: input.thinkingLevel }])
	return modelUseValidation.ok ? appendValidatedSelectedAgentRunModel(runtime, storage, input, stamp) : modelUseValidation
}

function appendValidatedSelectedAgentRunModel(
	runtime: CoreRuntime,
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return appendAgentRunEvent(runtime, storage, input.agentRunId, {
		type: 'agent-run-model-selected',
		modelId: input.modelId,
		thinkingLevel: input.thinkingLevel,
		authorized: stamp,
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp, seedSelectableModel } = await import('../utils/test-helpers')
	const { planningAgentRunFixture, revisionPlanningAgentRunFixture } = await import('./utils/agent-run-test-utils')

	describe('selectAgentRunModel command', () => {
		it('appends model selection for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, 'model-2')
			const command = createSelectAgentRunModelCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', modelId: 'model-2', thinkingLevel: 'off' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-event-1',
					agentRunId: 'agent-run-1',
					cursor: '01J00000000000000000000001',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'agent-run-model-selected',
						modelId: 'model-2',
						thinkingLevel: 'off',
						authorized: localStamp(),
					},
				},
			})
		})

		it('validates selectable models', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, 'model-2', { modelArchived: true })
			const command = createSelectAgentRunModelCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', modelId: 'model-2', thinkingLevel: 'off' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'archived-model-reference', modelId: 'model-2' } })
		})

		it('rejects Autonomous Agent Runs', async () => {
			const options = planningAgentRunFixture()
			seedSelectableModel(options.tx, 'model-2')
			options.tx.agentRuns.records.get('agent-run-1')!.purpose = {
				type: 'execution',
				deliveryId: 'delivery-1',
				sliceId: 'slice-1',
				mode: { type: 'initial' },
			}
			const command = createSelectAgentRunModelCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', modelId: 'model-2', thinkingLevel: 'off' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: 'agent-run-1' } })
		})

		it('rejects revision-planning Agent Runs whose Revision Gate is closed', async () => {
			const options = revisionPlanningAgentRunFixture(true)
			seedSelectableModel(options.tx, 'model-2')
			const command = createSelectAgentRunModelCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', modelId: 'model-2', thinkingLevel: 'off' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})
	})
}
