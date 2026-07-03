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
import type { CoreDispatchRequest } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { acceptDispatchRequest } from './utils/dispatch'
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

type DispatchedAgentRunMessage = {
	event: AgentRunEvent
	dispatchMarker: string
}

export function createSendAgentRunMessageCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('sendAgentRunMessage', sendAgentRunMessageInputPipe, async (input, context) => {
		const written = await withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<DispatchedAgentRunMessage, Exclude<Error, InvalidInputError>>> => {
				const agentRun = await requireInteractiveAgentRunTargetOpen(storage, input.agentRunId)
				if (!agentRun.ok) return agentRun

				const event = await appendAgentRunEvent(runtime, storage, input.agentRunId, {
					type: 'input-message',
					source: { type: 'operator', authorized: stamp },
					content: input.content,
				})
				if (!event.ok) return event

				const dispatchMarker = await acceptDispatchRequest(runtime.services.dispatcher, {
					type: 'agent-run',
					agentRunId: input.agentRunId,
					reason: { type: 'input-appended', inputEventId: event.value.id },
				})
				if (!dispatchMarker.ok) return dispatchMarker

				return { ok: true, value: { event: event.value, dispatchMarker: dispatchMarker.value } }
			},
		)
		if (!written.ok) return written

		runtime.services.dispatcher.ready(written.value.dispatchMarker)
		return { ok: true, value: written.value.event }
	})
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

		it('requests Agent Run Dispatch after appending an operator input message and readies it after commit', async () => {
			const dispatches: CoreDispatchRequest[] = []
			const readyMarkers: string[] = []
			const options = planningAgentRunFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return Promise.resolve('marker-1')
					},
					ready: (marker) => {
						readyMarkers.push(marker)
					},
				},
			})
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'Please refine the plan.' }] },
				context,
			)

			expect(result).toMatchObject({ ok: true })
			expect(dispatches).toEqual([
				{ type: 'agent-run', agentRunId: 'agent-run-1', reason: { type: 'input-appended', inputEventId: 'agent-run-event-1' } },
			])
			expect(readyMarkers).toEqual(['marker-1'])
		})

		it('rolls back the input message when dispatch request throws', async () => {
			const thrown = new Error('queue full')
			const options = planningAgentRunFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: () => Promise.reject(thrown),
					ready: () => {},
				},
			})

			const result = await sendNextTurn(options)

			expect(transactionFailureCause(result)).toBe(thrown)
			expectNoInputMessages(options)
		})

		it('rolls back the input message when dispatch returns an invalid marker', async () => {
			const options = planningAgentRunFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: () => Promise.resolve(''),
					ready: () => {
						throw new Error('ready should not be called')
					},
				},
			})

			const result = await sendNextTurn(options)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'dispatcher', operation: 'request' },
			})
			expectNoInputMessages(options)
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

	type SendAgentRunMessageResult = Awaited<ReturnType<ReturnType<typeof createSendAgentRunMessageCommand>>>

	async function sendNextTurn(options: ReturnType<typeof planningAgentRunFixture>): Promise<SendAgentRunMessageResult> {
		const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))
		return command({ agentRunId: 'agent-run-1', content: [{ type: 'text', text: 'Next turn.' }] }, context)
	}

	function transactionFailureCause(result: SendAgentRunMessageResult): unknown {
		expect(result).toMatchObject({ ok: false, error: { type: 'storage-operation-failed', operation: { type: 'transaction' } } })
		if (!result.ok && result.error.type === 'storage-operation-failed' && result.error.operation.type === 'transaction') {
			return result.error.operation.cause
		}
		throw new Error('Expected transaction storage failure')
	}

	function expectNoInputMessages(options: ReturnType<typeof planningAgentRunFixture>): void {
		expect(options.tx.agentRunEvents.records.size).toBe(0)
	}

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
