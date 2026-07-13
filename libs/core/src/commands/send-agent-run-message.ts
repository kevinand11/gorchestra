import { v, type PipeOutput } from 'valleyed'

import { agentRunInputTranscriptPartsPipe, type AgentRunEvent } from '../domain/agent-run-event'
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
import type { CoreDispatchRequest } from '../services'
import type { CommandContext } from './types'
import { requireInteractiveAgentRunOpen } from '../utils/agent-run-targets'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { withAuditStampTransaction } from '../utils/command-storage'
import { acceptAgentRunModelTurn } from '../utils/dispatch'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const sendAgentRunMessageInputPipe = v.object({
	agentRunId: idPipe,
	parts: agentRunInputTranscriptPartsPipe,
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
			async (storage, stamp, notifications): Promise<CoreResult<DispatchedAgentRunMessage, Exclude<Error, InvalidInputError>>> => {
				const agentRun = await requireInteractiveAgentRunOpen(storage, input.agentRunId)
				if (!agentRun.ok) return agentRun

				const event = await appendAgentRunEvent({ values: runtime.values, notifications }, storage, input.agentRunId, {
					type: 'input-message',
					source: { type: 'operator', authorized: stamp },
					parts: input.parts,
				})
				if (!event.ok) return event

				const dispatchMarker = await acceptAgentRunModelTurn(runtime.services.dispatcher, input.agentRunId, event.value.id)
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
	const { planningAgentRunFixture } = await import('../utils/agent-run-test-utils')

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
				{ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'Please refine the plan.', metadata: null }] },
				context,
			)

			expect(result).toEqual({ ok: true, value: expectedInputEvent('01k00000000000000000010001', 1) })
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010001')).toEqual(
				expectedInputEvent('01k00000000000000000010001', 1),
			)
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
				{ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'Please refine the plan.', metadata: null }] },
				context,
			)

			expect(result).toMatchObject({ ok: true })
			expect(dispatches).toEqual([
				{
					type: 'agent-run-model-turn',
					agentRunId: '01k00000000000000000000002',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: '01k00000000000000000000002' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'input-appended', inputEventId: '01k00000000000000000010001' },
				},
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
			options.tx.agentRunEvents.records.set('01k00000000000000000000003', {
				id: '01k00000000000000000000003',
				agentRunId: '01k00000000000000000000002',
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'turn-started',
					contextThroughEventId: '01j00000000000000000000000',
					reason: { type: 'input', inputEventIds: ['01j00000000000000000000000'] },
				},
			})
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'Next turn.', metadata: null }] },
				context,
			)

			expect(result).toMatchObject({ ok: true, value: { id: '01k00000000000000000010001' } })
		})

		it('rejects Autonomous Agent Runs as non-interactive', async () => {
			const options = planningAgentRunFixture()
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.purpose = {
				type: 'execution',
				deliveryId: '01k00000000000000000000008',
				sliceId: '01k00000000000000000000042',
				mode: { type: 'initial' },
			}
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'No.', metadata: null }] },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-interactive', agentRunId: '01k00000000000000000000002' } })
		})
	})

	type SendAgentRunMessageResult = Awaited<ReturnType<ReturnType<typeof createSendAgentRunMessageCommand>>>

	async function sendNextTurn(options: ReturnType<typeof planningAgentRunFixture>): Promise<SendAgentRunMessageResult> {
		const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))
		return command({ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'Next turn.', metadata: null }] }, context)
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

	function expectedInputEvent(id: string, _sequence: number): AgentRunEvent {
		return {
			id,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message',
				source: { type: 'operator', authorized: localStamp() },
				parts: [{ type: 'text', text: 'Please refine the plan.', metadata: null }],
			},
		}
	}
}
