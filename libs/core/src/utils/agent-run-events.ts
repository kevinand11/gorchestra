import type {
	AgentRun,
	AgentRunEvent,
	AgentRunEventBody,
	AgentRunEventCursor,
	AgentRunProfileSnapshot,
	AgentRunPurpose,
} from '../domain/agent-run'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { nextCursor, nextId, runtimeRecord, type CoreRuntimeValues } from './runtime-values'
import type { Result } from './types'
import { createRecord, getRequired } from '../storage/helpers'

type ModelAgentRunWithPurpose<TPurpose extends AgentRunPurpose> = Omit<AgentRun, 'agent' | 'purpose'> & {
	agent: { type: 'model' }
	purpose: TPurpose
}

export type AppendAgentRunEventError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export type CreateModelAgentRunError = AppendAgentRunEventError

export async function createModelAgentRunWithProfileSnapshot<TPurpose extends AgentRunPurpose>(
	storage: CoreStorage,
	input: {
		agentRunId: Id
		purpose: TPurpose
		started: RuntimeRecord
		profile: AgentRunProfileSnapshot
	},
): Promise<Result<ModelAgentRunWithPurpose<TPurpose>, CreateModelAgentRunError>> {
	const agentRun = modelAgentRun(input)
	const stored = await createRecord('agent-run', storage, agentRun)
	return stored.ok ? { ok: true, value: agentRun } : stored
}

function modelAgentRun<TPurpose extends AgentRunPurpose>(input: {
	agentRunId: Id
	purpose: TPurpose
	started: RuntimeRecord
	profile: AgentRunProfileSnapshot
}): ModelAgentRunWithPurpose<TPurpose> {
	return {
		id: input.agentRunId,
		agent: { type: 'model' },
		purpose: input.purpose,
		profile: input.profile,
		modelUseOverride: null,
		started: input.started,
		completed: null,
	}
}

export async function appendAgentRunEvent(
	values: { values: CoreRuntimeValues },
	storage: CoreStorage,
	agentRunId: Id,
	body: AgentRunEventBody,
): Promise<Result<AgentRunEvent, AppendAgentRunEventError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const facts = agentRunEventFacts(values.values)
	return facts.ok ? createRecord('agent-run-event', storage, agentRunEventRecord(agentRunId, facts.value, body)) : facts
}

interface AgentRunEventFacts {
	eventId: Id
	cursor: AgentRunEventCursor
	occurred: RuntimeRecord
}

function agentRunEventFacts(values: CoreRuntimeValues): Result<AgentRunEventFacts, InvalidCoreServiceOutputError> {
	const eventId = nextId(values, 'agent-run-event')
	if (!eventId.ok) return eventId

	const cursor = nextCursor(values, 'agent-run-event')
	if (!cursor.ok) return cursor

	const occurred = runtimeRecord(values)
	return occurred.ok ? { ok: true, value: { eventId: eventId.value, cursor: cursor.value, occurred: occurred.value } } : occurred
}

function agentRunEventRecord(agentRunId: Id, facts: AgentRunEventFacts, body: AgentRunEventBody): AgentRunEvent {
	return {
		id: facts.eventId,
		agentRunId,
		cursor: facts.cursor,
		occurred: facts.occurred,
		body,
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('./test-helpers')

	describe('createModelAgentRunWithProfileSnapshot', () => {
		it('creates a Model Agent Run with a profile snapshot and no transcript event', async () => {
			const options = createTestCoreServices()

			const result = await createModelAgentRunWithProfileSnapshot(options.storage, {
				agentRunId: 'agent-run-1',
				purpose: { type: 'planning', planId: 'plan-1' },
				started: { at: '2026-06-10T12:00:00.000Z' },
				profile: {
					agentRunProfileId: 'agent-run-profile-1',
					name: 'Planning',
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				},
			})

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-1',
					agent: { type: 'model' },
					purpose: { type: 'planning', planId: 'plan-1' },
					profile: {
						agentRunProfileId: 'agent-run-profile-1',
						name: 'Planning',
						modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
					},
					modelUseOverride: null,
					started: { at: '2026-06-10T12:00:00.000Z' },
					completed: null,
				},
			})
			expect(options.tx.agentRunEvents.records.size).toBe(0)
		})
	})

	describe('appendAgentRunEvent', () => {
		it('appends Agent Run Events with monotonic cursors', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.records.set('agent-run-1', {
				id: 'agent-run-1',
				agent: { type: 'model' },
				purpose: { type: 'planning', planId: 'plan-1' },
				profile: {
					agentRunProfileId: 'agent-run-profile-1',
					name: 'Planning',
					modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				},
				modelUseOverride: null,
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

			expect(first).toMatchObject({ ok: true, value: { id: 'agent-run-event-1', cursor: '01J00000000000000000000001' } })
			expect(second).toMatchObject({ ok: true, value: { id: 'agent-run-event-2', cursor: '01J00000000000000000000002' } })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')).toMatchObject({ cursor: '01J00000000000000000000001' })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')).toMatchObject({ cursor: '01J00000000000000000000002' })
		})
	})
}
