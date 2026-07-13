import { v, type PipeOutput } from 'valleyed'

import { agentRunSystemTranscriptPartsPipe, type AgentRunEvent } from '../domain/agent-run-event'
import { idPipe } from '../domain/commons'
import type {
	AgentRunNotActiveError,
	AgentRunNotInteractiveError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CommandContext } from './types'
import { requireInteractiveAgentRunOpen } from '../utils/agent-run-targets'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, withAuditStampTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

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
	| AgentRunNotInteractiveError
	| AgentRunNotActiveError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCompactAgentRunContextCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('compactAgentRunContext', compactAgentRunContextInputPipe, (input, context) =>
		withAuditStampTransaction<Result, Exclude<Error, InvalidInputError>>(runtime, context, async (storage, stamp, notifications) => {
			const agentRun = await requireInteractiveAgentRunOpen(storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			const compactedThrough = await getRequired('agent-run-event', storage, input.compactedThroughEventId)
			if (!compactedThrough.ok) return compactedThrough
			if (compactedThrough.value.agentRunId !== input.agentRunId) {
				return {
					ok: false,
					error: {
						type: 'invariant-violation',
						message: `Agent Run Event ${compactedThrough.value.id} is outside Agent Run ${input.agentRunId}.`,
					},
				}
			}

			return appendAgentRunEvent({ values: runtime.values, notifications }, storage, input.agentRunId, {
				type: 'context-compacted',
				source: { type: 'operator', authorized: stamp },
				compactedThroughEventId: compactedThrough.value.id,
				replacementParts: input.replacementParts,
			})
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp } = await import('../utils/test-helpers')
	const { inputEvent, planningAgentRunFixture } = await import('../utils/agent-run-test-utils')
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
