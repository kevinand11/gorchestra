import type { AgentRun, AgentRunEvent, AgentRunEventBody, AgentRunProfileSnapshot, AgentRunPurpose } from '../domain/agent-run'
import { appendUniqueRuntimeRequirements, type AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { nextId, runtimeRecord, type CoreRuntimeValues } from './runtime-values'
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
		sourceRuntimeRequirements?: AgentRunRuntimeRequirement[]
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
	sourceRuntimeRequirements?: AgentRunRuntimeRequirement[]
}): ModelAgentRunWithPurpose<TPurpose> {
	const sourceRuntimeRequirements = input.sourceRuntimeRequirements ?? []
	const desiredRuntimeRequirements = appendUniqueRuntimeRequirements(sourceRuntimeRequirements, input.profile.runtimeRequirements)
	return {
		id: input.agentRunId,
		agent: { type: 'model' },
		purpose: input.purpose,
		profile: input.profile,
		modelUseOverride: null,
		sourceRuntimeRequirements,
		runtimeRequirementOverrides: [],
		desiredRuntimeRequirements,
		blocked: { type: 'sandbox-preparation-pending', blocked: input.started },
		sandbox: { assignment: null, appliedRequirements: [], appliedThroughEventId: null, released: null },
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
	occurred: RuntimeRecord
}

function agentRunEventFacts(values: CoreRuntimeValues): Result<AgentRunEventFacts, InvalidCoreServiceOutputError> {
	const eventId = nextId(values)
	if (!eventId.ok) return eventId

	const occurred = runtimeRecord(values)
	return occurred.ok ? { ok: true, value: { eventId: eventId.value, occurred: occurred.value } } : occurred
}

function agentRunEventRecord(agentRunId: Id, facts: AgentRunEventFacts, body: AgentRunEventBody): AgentRunEvent {
	return {
		id: facts.eventId,
		agentRunId,
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
				agentRunId: '01k00000000000000000000002',
				purpose: { type: 'planning', planId: '01k00000000000000000000028' },
				started: { at: '2026-06-10T12:00:00.000Z' },
				profile: {
					agentRunProfileId: '01k00000000000000000000006',
					name: 'Planning',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
				},
			})

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000002',
					agent: { type: 'model' },
					purpose: { type: 'planning', planId: '01k00000000000000000000028' },
					profile: {
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Planning',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [],
					},
					modelUseOverride: null,
					sourceRuntimeRequirements: [],
					runtimeRequirementOverrides: [],
					desiredRuntimeRequirements: [],
					blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
					sandbox: { assignment: null, appliedRequirements: [], appliedThroughEventId: null, released: null },
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
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				id: '01k00000000000000000000002',
				agent: { type: 'model' },
				purpose: { type: 'planning', planId: '01k00000000000000000000028' },
				profile: {
					agentRunProfileId: '01k00000000000000000000006',
					name: 'Planning',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
				},
				modelUseOverride: null,
				sourceRuntimeRequirements: [],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [],
				blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: { assignment: null, appliedRequirements: [], appliedThroughEventId: null, released: null },
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			})

			const first = await appendAgentRunEvent(options, options.storage, '01k00000000000000000000002', {
				type: 'input-message',
				source: { type: 'runtime' },
				parts: [{ type: 'text', text: 'hello', metadata: null }],
			})
			const second = await appendAgentRunEvent(options, options.storage, '01k00000000000000000000002', {
				type: 'interrupt-requested',
				source: { type: 'runtime' },
				reason: null,
			})

			expect(first).toMatchObject({ ok: true, value: { id: '01k00000000000000000010001' } })
			expect(second).toMatchObject({ ok: true, value: { id: '01k00000000000000000010002' } })
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010001')).toMatchObject({ id: '01k00000000000000000010001' })
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010002')).toMatchObject({ id: '01k00000000000000000010002' })
		})
	})
}
