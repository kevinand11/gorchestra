import { v, type PipeOutput } from 'valleyed'

import type { AgentRunEvent } from '../domain/agent-run-event'
import { freeFormStringPipe, idPipe } from '../domain/commons'
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

const interruptAgentRunInputPipe = v.object({ agentRunId: idPipe, reason: v.nullable(freeFormStringPipe) })
export type Input = PipeOutput<typeof interruptAgentRunInputPipe>

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

export function createInterruptAgentRunCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('interruptAgentRun', interruptAgentRunInputPipe, (input, context) =>
		withAuditStampTransaction<Result, Exclude<Error, InvalidInputError>>(runtime, context, async (storage, stamp, notifications) => {
			const agentRun = await getRequired('agent-run', storage, input.agentRunId)
			if (!agentRun.ok) return agentRun
			if (agentRun.value.completed !== null) {
				return { ok: false, error: { type: 'agent-run-not-active', agentRunId: agentRun.value.id } }
			}
			if (agentRun.value.purpose.type === 'planning' || agentRun.value.purpose.type === 'revision-planning') {
				const interactiveAgentRun = await requireInteractiveAgentRunOpen(storage, agentRun.value.id)
				if (!interactiveAgentRun.ok) return interactiveAgentRun
			}

			return appendAgentRunEvent({ values: runtime.values, notifications }, storage, input.agentRunId, {
				type: 'interrupt-requested',
				source: { type: 'operator', authorized: stamp },
				reason: input.reason,
			})
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp } = await import('../utils/test-helpers')
	const { autonomousAgentRunFixture, planningAgentRunFixture } = await import('../utils/agent-run-test-utils')

	describe('interruptAgentRun command', () => {
		it('appends an operator interrupt for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			const command = createInterruptAgentRunCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: '01k00000000000000000000002', reason: 'Pause please.' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					agentRunId: '01k00000000000000000000002',
					occurred: { at: '2026-06-10T12:00:00.000Z' },
					body: {
						type: 'interrupt-requested',
						source: { type: 'operator', authorized: localStamp() },
						reason: 'Pause please.',
					},
				},
			})
		})

		it('rejects completed Autonomous Agent Runs', async () => {
			const options = autonomousAgentRunFixture(true)
			const command = createInterruptAgentRunCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: '01k00000000000000000000002', reason: null }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: '01k00000000000000000000002' } })
		})
	})
}
