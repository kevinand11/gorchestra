import type { AgentRun, AgentRunEvent, AgentRunEventBody, AgentRunEventCursor, AgentRunPurpose } from '../domain/agent-run'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { Model, ModelThinkingLevel } from '../domain/model'
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

export async function createModelAgentRunWithInitialModel<TPurpose extends AgentRunPurpose>(
	values: { values: CoreRuntimeValues },
	storage: CoreStorage,
	input: {
		agentRunId: Id
		purpose: TPurpose
		started: RuntimeRecord
		modelId: Id
		thinkingLevel: ModelThinkingLevel
	},
): Promise<Result<ModelAgentRunWithPurpose<TPurpose>, CreateModelAgentRunError>> {
	const modelSelection = await getModelSelection(storage, input.modelId, input.thinkingLevel)
	return modelSelection.ok ? createModelAgentRunWithSelection(values, storage, input, modelSelection.value) : modelSelection
}

interface ModelSelection {
	model: Model
	thinkingLevel: ModelThinkingLevel
}

async function getModelSelection(
	storage: CoreStorage,
	modelId: Id,
	thinkingLevel: ModelThinkingLevel,
): Promise<Result<ModelSelection, CreateModelAgentRunError>> {
	const model = await getRequired('model', storage, modelId)
	return model.ok ? { ok: true, value: { model: model.value, thinkingLevel } } : model
}

async function createModelAgentRunWithSelection<TPurpose extends AgentRunPurpose>(
	values: { values: CoreRuntimeValues },
	storage: CoreStorage,
	input: { agentRunId: Id; purpose: TPurpose; started: RuntimeRecord },
	selection: ModelSelection,
): Promise<Result<ModelAgentRunWithPurpose<TPurpose>, CreateModelAgentRunError>> {
	const agentRun = modelAgentRun(input)
	const stored = await createRecord('agent-run', storage, agentRun)
	return stored.ok ? appendInitialModelSelection(values, storage, agentRun, selection) : stored
}

async function appendInitialModelSelection<TPurpose extends AgentRunPurpose>(
	values: { values: CoreRuntimeValues },
	storage: CoreStorage,
	agentRun: ModelAgentRunWithPurpose<TPurpose>,
	selection: ModelSelection,
): Promise<Result<ModelAgentRunWithPurpose<TPurpose>, CreateModelAgentRunError>> {
	const event = await appendAgentRunEvent(values, storage, agentRun.id, {
		type: 'agent-run-model-selected',
		modelId: selection.model.id,
		thinkingLevel: selection.thinkingLevel,
		authorized: null,
	})
	return event.ok ? { ok: true, value: agentRun } : event
}

function modelAgentRun<TPurpose extends AgentRunPurpose>(input: {
	agentRunId: Id
	purpose: TPurpose
	started: RuntimeRecord
}): ModelAgentRunWithPurpose<TPurpose> {
	return {
		id: input.agentRunId,
		agent: { type: 'model' },
		purpose: input.purpose,
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
	const { defaultModelCapabilities } = await import('../domain/model')

	describe('createModelAgentRunWithInitialModel', () => {
		it('creates a Model Agent Run with an initial model selection event', async () => {
			const options = createTestCoreServices()
			options.tx.modelProviders.records.set('model-provider-1', {
				id: 'model-provider-1',
				name: 'Provider',
				protocol: { type: 'anthropic-messages' },
				baseUrl: 'https://api.example.com',
				auth: null,
				headers: [],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			})
			options.tx.models.records.set('model-1', {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'Model',
				providerModelId: 'provider-model',
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			})

			const result = await createModelAgentRunWithInitialModel(options, options.storage, {
				agentRunId: 'agent-run-1',
				purpose: { type: 'planning', planId: 'plan-1' },
				started: { at: '2026-06-10T12:00:00.000Z' },
				modelId: 'model-1',
				thinkingLevel: 'none',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'agent-run-1',
					agent: { type: 'model' },
					purpose: { type: 'planning', planId: 'plan-1' },
					started: { at: '2026-06-10T12:00:00.000Z' },
					completed: null,
				},
			})
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')?.body).toEqual({
				type: 'agent-run-model-selected',
				modelId: 'model-1',
				thinkingLevel: 'none',
				authorized: null,
			})
		})
	})

	describe('appendAgentRunEvent', () => {
		it('appends Agent Run Events with monotonic cursors', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.records.set('agent-run-1', {
				id: 'agent-run-1',
				agent: { type: 'model' },
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

			expect(first).toMatchObject({ ok: true, value: { id: 'agent-run-event-1', cursor: '01J00000000000000000000001' } })
			expect(second).toMatchObject({ ok: true, value: { id: 'agent-run-event-2', cursor: '01J00000000000000000000002' } })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-1')).toMatchObject({ cursor: '01J00000000000000000000001' })
			expect(options.tx.agentRunEvents.records.get('agent-run-event-2')).toMatchObject({ cursor: '01J00000000000000000000002' })
		})
	})
}
