import type { AgentRunEvent, AgentRunEventBody } from '../domain/agent-run'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { nextId, runtimeRecord, type CoreRuntimeValues } from './runtime-values'
import type { Result } from './types'
import { createRecord, getRequired, listRecords } from '../storage/helpers'

export type AppendAgentRunEventError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export async function appendAgentRunEvent(
	values: { values: CoreRuntimeValues },
	storage: CoreStorage,
	agentRunId: Id,
	body: AgentRunEventBody,
): Promise<Result<AgentRunEvent, AppendAgentRunEventError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const facts = await agentRunEventFacts(values.values, storage, agentRunId)
	return facts.ok ? createRecord('agent-run-event', storage, agentRunEventRecord(agentRunId, facts.value, body)) : facts
}

interface AgentRunEventFacts {
	eventId: Id
	occurred: RuntimeRecord
	sequence: number
}

async function agentRunEventFacts(
	values: CoreRuntimeValues,
	storage: CoreStorage,
	agentRunId: Id,
): Promise<Result<AgentRunEventFacts, InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const runtimeFacts = agentRunEventRuntimeFacts(values)
	if (!runtimeFacts.ok) return runtimeFacts

	const sequence = await nextAgentRunEventSequence(storage, agentRunId)
	return sequence.ok ? { ok: true, value: { ...runtimeFacts.value, sequence: sequence.value } } : sequence
}

function agentRunEventRuntimeFacts(values: CoreRuntimeValues): Result<Omit<AgentRunEventFacts, 'sequence'>, InvalidCoreServiceOutputError> {
	const eventId = nextId(values, 'agent-run-event')
	if (!eventId.ok) return eventId

	const occurred = runtimeRecord(values)
	return occurred.ok ? { ok: true, value: { eventId: eventId.value, occurred: occurred.value } } : occurred
}

function agentRunEventRecord(agentRunId: Id, facts: AgentRunEventFacts, body: AgentRunEventBody): AgentRunEvent {
	return {
		id: facts.eventId,
		agentRunId,
		sequence: facts.sequence,
		occurred: facts.occurred,
		body,
	}
}

async function nextAgentRunEventSequence(
	storage: CoreStorage,
	agentRunId: Id,
): Promise<Result<number, InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const latest = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'sequence', direction: 'desc' }],
		limit: 1,
	})
	if (!latest.ok) return latest

	return { ok: true, value: (latest.value[0]?.sequence ?? 0) + 1 }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('./test-helpers')

	describe('appendAgentRunEvent', () => {
		it('appends Agent Run Events with monotonic per-AgentRun sequence', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.records.set('agent-run-1', {
				id: 'agent-run-1',
				agent: { type: 'model', modelId: 'model-1' },
				purpose: { type: 'planning', planId: 'plan-1' },
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})

			const first = await appendAgentRunEvent(options, options.storage, 'agent-run-1', {
				type: 'input-message',
				source: { type: 'runtime' },
				content: [{ type: 'text', text: 'hello' }],
			})
			const second = await appendAgentRunEvent(options, options.storage, 'agent-run-1', {
				type: 'interrupt-requested',
				source: { type: 'runtime' },
				reason: null,
			})

			expect(first).toMatchObject({ ok: true, value: { id: 'agent-run-event-1', sequence: 1 } })
			expect(second).toMatchObject({ ok: true, value: { id: 'agent-run-event-2', sequence: 2 } })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')).toMatchObject({ sequence: 1 })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')).toMatchObject({ sequence: 2 })
		})
	})
}
