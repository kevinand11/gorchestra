import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRun, AgentRunEvent } from '../domain/agent-run'
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
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { requireInteractiveAgentRunTargetOpen } from '../utils/agent-run-targets'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, withAuditStampTransaction } from './utils/storage'

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
		withAuditStampTransaction(
			runtime,
			context,
			async (storage, stamp): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> => {
				const agentRun = await requireInterruptibleAgentRun(storage, input.agentRunId)
				if (!agentRun.ok) return agentRun

				return appendAgentRunEvent(runtime, storage, input.agentRunId, {
					type: 'interrupt-requested',
					source: { type: 'operator', authorized: stamp },
					reason: input.reason,
				})
			},
		),
	)
}

async function requireInterruptibleAgentRun(
	storage: CoreStorage,
	agentRunId: string,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	return agentRun.ok ? validateInterruptibleAgentRun(storage, agentRun.value) : agentRun
}

async function validateInterruptibleAgentRun(
	storage: CoreStorage,
	agentRun: AgentRun,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	const active = validateAgentRunActive(agentRun)
	return active.ok ? validateInterruptibleAgentRunTarget(storage, agentRun) : active
}

function validateAgentRunActive(agentRun: AgentRun): CoreResult<void, AgentRunNotActiveError> {
	return agentRun.completed === null ? { ok: true, value: undefined } : agentRunNotActive(agentRun.id)
}

async function validateInterruptibleAgentRunTarget(
	storage: CoreStorage,
	agentRun: AgentRun,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	return isInteractiveAgentRun(agentRun) ? requireInteractiveAgentRunTargetOpen(storage, agentRun.id) : { ok: true, value: agentRun }
}

function isInteractiveAgentRun(agentRun: { purpose: { type: string } }): boolean {
	return agentRun.purpose.type === 'planning' || agentRun.purpose.type === 'revision-planning'
}

function agentRunNotActive(agentRunId: string): CoreResult<never, AgentRunNotActiveError> {
	return { ok: false, error: { type: 'agent-run-not-active', agentRunId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, localStamp } = await import('../utils/test-helpers')
	const { autonomousAgentRunFixture, planningAgentRunFixture, revisionPlanningAgentRunFixture } =
		await import('./utils/agent-run-test-utils')

	describe('interruptAgentRun command', () => {
		it('appends an operator interrupt for an active Planning Agent Run', async () => {
			const options = planningAgentRunFixture()
			const command = createInterruptAgentRunCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', reason: 'Pause please.' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-event-1',
					agentRunId: 'agent-run-1',
					sequence: 1,
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

			const result = await command({ agentRunId: 'agent-run-1', reason: null }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})

		it('rejects revision-planning Agent Runs whose Revision Gate is closed', async () => {
			const options = revisionPlanningAgentRunFixture(true)
			const command = createInterruptAgentRunCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunId: 'agent-run-1', reason: null }, context)

			expect(result).toEqual({ ok: false, error: { type: 'agent-run-not-active', agentRunId: 'agent-run-1' } })
		})
	})
}
