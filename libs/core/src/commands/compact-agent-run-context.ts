import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { agentRunSystemTranscriptPartsPipe, type AgentRunEvent } from '../domain/agent-run'
import { idPipe } from '../domain/commons'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
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
import { getRequired, withAuditStampTransaction } from './utils/storage'

const compactAgentRunContextInputPipe = v.object({
	agentRunId: idPipe,
	replacementParts: agentRunSystemTranscriptPartsPipe,
	compactedThroughEventId: idPipe,
})
export type Input = PipeOutput<typeof compactAgentRunContextInputPipe>

export type Result = AgentRunEvent
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| PlanClosedError
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCompactAgentRunContextCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('compactAgentRunContext', compactAgentRunContextInputPipe, (input, context) =>
		withAuditStampTransaction(runtime, context, async (storage, stamp) => {
			const agentRun = await requireInteractiveAgentRunTargetOpen(storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			const compactedThrough = await validateCompactedThroughEvent(storage, input)
			if (!compactedThrough.ok) return compactedThrough

			return appendAgentRunEvent(runtime, storage, input.agentRunId, {
				type: 'context-compacted',
				source: { type: 'operator', authorized: stamp },
				compactedThroughEventId: compactedThrough.value.id,
				replacementParts: input.replacementParts,
			})
		}),
	)
}

async function validateCompactedThroughEvent(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<AgentRunEvent, Exclude<Error, InvalidInputError>>> {
	const event = await getRequired('agent-run-event', storage, input.compactedThroughEventId)
	return event.ok ? validateCompactedThroughEventMatchesInput(event.value, input) : event
}

function validateCompactedThroughEventMatchesInput(event: AgentRunEvent, input: Input): CoreResult<AgentRunEvent, InvariantViolationError> {
	return event.agentRunId === input.agentRunId
		? { ok: true, value: event }
		: invariant(`Agent Run Event ${event.id} is outside Agent Run ${input.agentRunId}.`)
}

function invariant<TValue = never>(message: string): CoreResult<TValue, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp } = await import('../utils/test-helpers')
	const { inputEvent, planningAgentRunFixture } = await import('./utils/agent-run-test-utils')
	const existingEventId = '01k00000000000000000000003'
	const outsideEventId = '01k00000000000000000000004'
	const outsideAgentRunId = '01k00000000000000000100021'

	describe('compactAgentRunContext command', () => {
		it('appends an operator context compaction for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRunEvents.records.set(existingEventId, inputEvent(existingEventId, '01k00000000000000000000002', 0))
			const command = createCompactAgentRunContextCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunId: '01k00000000000000000000002',
					replacementParts: [{ type: 'text', text: 'Earlier context summary.', metadata: null }],
					compactedThroughEventId: existingEventId,
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					agentRunId: '01k00000000000000000000002',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'context-compacted',
						source: { type: 'operator', authorized: localStamp() },
						compactedThroughEventId: existingEventId,
						replacementParts: [{ type: 'text', text: 'Earlier context summary.', metadata: null }],
					},
				},
			})
		})

		it('rejects inactive targets', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.completed = { at: '2026-06-10T12:05:00.000Z' }
			options.tx.agentRunEvents.records.set(existingEventId, inputEvent(existingEventId, '01k00000000000000000000002', 0))
			const command = createCompactAgentRunContextCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					agentRunId: '01k00000000000000000000002',
					replacementParts: [{ type: 'text', text: 'Summary.', metadata: null }],
					compactedThroughEventId: existingEventId,
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: '01k00000000000000000000002' } })
		})

		it('rejects first kept events outside the Agent Run', async () => {
			const outsideEventOptions = planningAgentRunFixture()
			outsideEventOptions.tx.agentRunEvents.records.set(outsideEventId, inputEvent(outsideEventId, outsideAgentRunId, 1))
			await expect(
				createCompactAgentRunContextCommand(createTestCoreRuntime(outsideEventOptions))(
					{
						agentRunId: '01k00000000000000000000002',
						replacementParts: [{ type: 'text', text: 'Summary.', metadata: null }],
						compactedThroughEventId: outsideEventId,
					},
					context,
				),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: `Agent Run Event ${outsideEventId} is outside Agent Run 01k00000000000000000000002.`,
				},
			})
		})
	})
}
