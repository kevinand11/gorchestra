import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { agentRunTextContentPipe, type AgentRunEvent } from '../domain/agent-run'
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
import type { CoreRuntime } from '../runtime'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { requireInteractiveAgentRunTargetOpen } from '../utils/agent-run-targets'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { withAuditStampTransaction } from './utils/storage'

const sendAgentRunMessageInputPipe = v.object({
	agentRunId: idPipe,
	content: v.array(agentRunTextContentPipe),
})
export type Input = PipeOutput<typeof sendAgentRunMessageInputPipe>

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

export function createSendAgentRunMessageCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('sendAgentRunMessage', sendAgentRunMessageInputPipe, (input, context) =>
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> => {
				const agentRun = await requireInteractiveAgentRunTargetOpen(storage, input.agentRunId)
				if (!agentRun.ok) return agentRun

				return appendAgentRunEvent(runtime, storage, input.agentRunId, {
					type: 'input-message',
					source: { type: 'operator', authorized: stamp },
					content: input.content,
				})
			},
		),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')
	const { planningAgentRunFixture, revisionPlanningAgentRunFixture } = await import('./utils/agent-run-test-utils')

	describe('sendAgentRunMessage command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'sendAgentRunMessage' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('appends an operator input message for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'Please refine the plan.' }] },
				context,
			)

			expect(result).toEqual({ ok: true, value: expectedInputEvent('agent-run-event-1', 1) })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')).toEqual(expectedInputEvent('agent-run-event-1', 1))
		})

		it('appends during an active turn for the next safe boundary', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRunEvents.records.set('agent-run-event-1', {
				id: 'agent-run-event-1',
				agentRunId: 'agent-run-1',
				sequence: 1,
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: { type: 'turn-started', contextThroughSequence: 0, reason: { type: 'input', inputEventIds: [] } },
			})
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'Next turn.' }] }, context)

			expect(result).toMatchObject({ ok: true, value: { sequence: 2 } })
		})

		it('rejects Autonomous Agent Runs as non-interactive', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRuns.records.get('agent-run-1')!.purpose = {
				type: 'execution',
				deliveryId: 'delivery-1',
				sliceId: 'slice-1',
				mode: { type: 'initial' },
			}
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'No.' }] }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: 'agent-run-1' } })
		})

		it('rejects revision-planning Agent Runs whose Revision Gate is closed', async () => {
			const options = revisionPlanningAgentRunFixture(true)
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'No.' }] }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})
	})

	function expectedInputEvent(id: string, sequence: number): AgentRunEvent {
		return {
			id,
			agentRunId: 'agent-run-1',
			sequence,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message',
				source: { type: 'operator', authorized: localStamp() },
				content: [{ type: 'text', text: 'Please refine the plan.' }],
			},
		}
	}
}
