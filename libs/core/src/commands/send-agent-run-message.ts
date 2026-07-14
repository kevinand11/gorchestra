import { v, type PipeOutput } from 'valleyed'

import { requestAgentRunModelTurn } from '../dispatch/accept'
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
import type { CommandContext } from './types'
import { requireInteractiveAgentRunOpen } from '../utils/agent-run-targets'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp } from '../utils/command-storage'
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

export function createSendAgentRunMessageCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('sendAgentRunMessage', sendAgentRunMessageInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run<Result, Exclude<Error, InvalidInputError>>(async ({ storage, notifications, dispatch }) => {
			const agentRun = await requireInteractiveAgentRunOpen(storage, input.agentRunId)
			if (!agentRun.ok) return agentRun

			const event = await appendAgentRunEvent({ values: runtime.values, notifications }, storage, input.agentRunId, {
				type: 'input-message',
				source: { type: 'operator', authorized: stamp.value },
				parts: input.parts,
			})
			if (!event.ok) return event

			const requested = await requestAgentRunModelTurn(dispatch, input.agentRunId, event.value.id)
			return requested.ok ? event : requested
		})
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

		it('persists Agent Run Dispatch after appending an operator input message and wakes after commit', async () => {
			const wakes: string[] = []
			const options = planningAgentRunFixture({
				dispatchWake: { publish: () => wakes.push('wake'), subscribe: () => () => {} },
			})
			const command = createSendAgentRunMessageCommand(createTestCoreRuntime(options))

			const result = await command(
				{ agentRunId: '01k00000000000000000000002', parts: [{ type: 'text', text: 'Please refine the plan.', metadata: null }] },
				context,
			)

			expect(result).toMatchObject({ ok: true })
			expect([...options.tx.dispatchRequests.records.values()].map((request) => request.payload)).toEqual([
				{ type: 'agent-run-model-turn', agentRunId: '01k00000000000000000000002' },
			])
			expect(wakes).toEqual(['wake'])
		})

		it('rolls back the input message when Dispatch persistence fails', async () => {
			const options = planningAgentRunFixture()
			options.tx.dispatchRequests.fail.put = true

			const result = await sendNextTurn(options)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'create', resource: 'dispatch-request' } },
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
