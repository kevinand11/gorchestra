import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunEvent } from '../domain/agent-run'
import { freeFormStringPipe, idPipe } from '../domain/commons'
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
	summary: freeFormStringPipe,
	firstKeptEventId: idPipe,
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

			const firstKept = await validateFirstKeptEvent(storage, input)
			if (!firstKept.ok) return firstKept

			return appendAgentRunEvent(runtime, storage, input.agentRunId, {
				type: 'context-compacted',
				source: { type: 'operator', authorized: stamp },
				summary: input.summary,
				firstKeptCursor: firstKept.value.cursor,
			})
		}),
	)
}

async function validateFirstKeptEvent(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<AgentRunEvent, Exclude<Error, InvalidInputError>>> {
	const event = await getRequired('agent-run-event', storage, input.firstKeptEventId)
	return event.ok ? validateFirstKeptEventMatchesInput(event.value, input) : event
}

function validateFirstKeptEventMatchesInput(event: AgentRunEvent, input: Input): CoreResult<AgentRunEvent, InvariantViolationError> {
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

	describe('compactAgentRunContext command', () => {
		it('appends an operator context compaction for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRunEvents.records.set('existing-event', inputEvent('existing-event', 'agent-run-1', 0))
			const command = createCompactAgentRunContextCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: 'agent-run-1', summary: 'Earlier context summary.', firstKeptEventId: 'existing-event' },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-event-1',
					agentRunId: 'agent-run-1',
					cursor: '01J00000000000000000000001',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'context-compacted',
						source: { type: 'operator', authorized: localStamp() },
						summary: 'Earlier context summary.',
						firstKeptCursor: '01J00000000000000000000000',
					},
				},
			})
		})

		it('rejects inactive targets', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRuns.records.get('agent-run-1')!.completed = { at: '2026-06-10T12:05:00.000Z' }
			options.tx.agentRunEvents.records.set('existing-event', inputEvent('existing-event', 'agent-run-1', 0))
			const command = createCompactAgentRunContextCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', summary: 'Summary.', firstKeptEventId: 'existing-event' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})

		it('rejects first kept events outside the Agent Run', async () => {
			const outsideEventOptions = planningAgentRunFixture()
			outsideEventOptions.tx.agentRunEvents.records.set('agent-run-event-1', inputEvent('agent-run-event-1', 'agent-run-other', 1))
			await expect(
				createCompactAgentRunContextCommand(createTestCoreRuntime(outsideEventOptions))(
					{ agentRunId: 'agent-run-1', summary: 'Summary.', firstKeptEventId: 'agent-run-event-1' },
					context,
				),
			).resolves.toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Agent Run Event agent-run-event-1 is outside Agent Run agent-run-1.' },
			})
		})
	})
}
