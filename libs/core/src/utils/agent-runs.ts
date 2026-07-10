import { resolveAgentRunSourceSetup } from './agent-run-source-resolvers'
import { agentRunProfileSnapshot } from './command-storage'
import { acceptAgentRunPreparation, acceptAgentRunSandboxRelease } from './dispatch'
import { validateRuntimeRequirementSecretReferences, type RuntimeRequirementSecretReferenceError } from './runtime-requirement-secrets'
import { nextId, runtimeRecord, type CoreRuntimeValues } from './runtime-values'
import type { Result } from './types'
import type { AgentRun, AgentRunProfileSnapshot, AgentRunPurpose, AgentRunToolSet } from '../domain/agent-run'
import type { AgentRunEvent, AgentRunEventBody } from '../domain/agent-run-event'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { appendUniqueRuntimeRequirements, type AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { Project } from '../domain/project'
import type {
	AgentRunTurnActiveError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { instructionForProjectAndAgentRunPurpose } from './runtime/agent-runs/instructions'
import { createRecord, getRequired, listRecords, updateRecord } from './storage/helpers'

export type AgentRunLookupError = InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError
export type AgentRunCompletionError = AgentRunLookupError | ResourceNotFoundError
export type AgentRunByIdCompletionError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
export type AgentRunIdleError = InvalidCoreServiceOutputError | StorageOperationFailedError | AgentRunTurnActiveError

export function agentRunSandboxPrepared(agentRun: AgentRun): boolean {
	return (
		agentRun.sandbox !== null &&
		agentRun.sandbox.released === null &&
		agentRun.blocked === null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughEventId === latestRuntimeRequirementOverrideEventId(agentRun)
	)
}

export async function requireAgentRunIdle(storage: CoreStorage, agentRunId: Id): Promise<Result<void, AgentRunIdleError>> {
	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'id', direction: 'asc' }],
	})
	return events.ok ? activeTurn(events.value) : events
}

function activeTurn(events: AgentRunEvent[]): Result<void, AgentRunTurnActiveError> {
	const started = [...events].reverse().find((event) => event.body.type === 'turn-started')
	if (started === undefined || started.body.type !== 'turn-started') return { ok: true, value: undefined }

	const ended = events.some(
		(event) => event.id > started.id && event.body.type === 'turn-ended' && event.body.turnStartedEventId === started.id,
	)
	return ended ? { ok: true, value: undefined } : agentRunTurnActive(started.agentRunId, started.id)
}

function agentRunTurnActive(agentRunId: Id, turnStartedEventId: Id): Result<never, AgentRunTurnActiveError> {
	return { ok: false, error: { type: 'agent-run-turn-active', agentRunId, turnStartedEventId } }
}

function latestRuntimeRequirementOverrideEventId(agentRun: AgentRun): string | null {
	return agentRun.runtimeRequirementOverrides.at(-1)?.eventId ?? null
}

type ModelAgentRunWithPurpose<TPurpose extends AgentRunPurpose> = Omit<AgentRun, 'agent' | 'purpose'> & {
	agent: { type: 'model' }
	purpose: TPurpose
}

export type AppendAgentRunEventError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export type CreateModelAgentRunError = AppendAgentRunEventError | RuntimeRequirementSecretReferenceError

export async function createModelAgentRunAndRequestPreparation<TPurpose extends AgentRunPurpose>(
	context: { values: CoreRuntimeValues; dispatcher: CoreServices['dispatcher'] },
	storage: CoreStorage,
	input: {
		agentRunId: Id
		agentRunProfile: AgentRunProfile
		project: Project
		purpose: TPurpose
		started: RuntimeRecord
	},
): Promise<
	Result<
		{
			agentRun: ModelAgentRunWithPurpose<TPurpose>
			instructionEvent: AgentRunEvent
			preparationDispatchMarker: string
		},
		CreateModelAgentRunError
	>
> {
	const sourceSetup = await resolveAgentRunSourceSetup(storage, input.purpose)
	if (!sourceSetup.ok) return sourceSetup

	const sourceSecretValidation = await validateRuntimeRequirementSecretReferences(storage, sourceSetup.value.runtimeRequirements)
	if (!sourceSecretValidation.ok) return sourceSecretValidation

	const agentRun = modelAgentRun({
		...input,
		profile: agentRunProfileSnapshot(input.agentRunProfile),
		sourceRuntimeRequirements: sourceSetup.value.runtimeRequirements,
		toolSet: sourceSetup.value.toolSet,
	})
	const stored = await createRecord('agent-run', storage, agentRun)
	if (!stored.ok) return stored

	const instruction = instructionForProjectAndAgentRunPurpose(agentRun.purpose, input.project)
	const instructionEvent = await appendAgentRunEvent({ values: context.values }, storage, agentRun.id, instruction)
	if (!instructionEvent.ok) return instructionEvent

	const preparationDispatchMarker = await acceptAgentRunPreparation(context.dispatcher, agentRun.id, { type: 'agent-run-created' })
	if (!preparationDispatchMarker.ok) return preparationDispatchMarker

	return {
		ok: true,
		value: {
			agentRun,
			instructionEvent: instructionEvent.value,
			preparationDispatchMarker: preparationDispatchMarker.value,
		},
	}
}

function modelAgentRun<TPurpose extends AgentRunPurpose>(input: {
	agentRunId: Id
	purpose: TPurpose
	started: RuntimeRecord
	profile: AgentRunProfileSnapshot
	sourceRuntimeRequirements: AgentRunRuntimeRequirement[]
	toolSet: AgentRunToolSet
}): ModelAgentRunWithPurpose<TPurpose> {
	const desiredRuntimeRequirements = appendUniqueRuntimeRequirements(input.sourceRuntimeRequirements, input.profile.runtimeRequirements)
	return {
		id: input.agentRunId,
		agent: { type: 'model' },
		purpose: input.purpose,
		profile: input.profile,
		toolSet: input.toolSet,
		modelUseOverride: null,
		sourceRuntimeRequirements: input.sourceRuntimeRequirements,
		runtimeRequirementOverrides: [],
		desiredRuntimeRequirements,
		blocked: { type: 'preparation-pending', blocked: input.started },
		sandbox: null,
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

export async function completeAgentRunByIdAndAcceptSandboxRelease(
	storage: CoreStorage,
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
	completed: RuntimeRecord,
): Promise<Result<{ agentRun: AgentRun; dispatchMarker: string | null }, AgentRunByIdCompletionError | InvalidCoreServiceOutputError>> {
	const current = await getRequired('agent-run', storage, agentRunId)
	if (!current.ok) return current

	const agentRun = current.value
	if (agentRun.completed !== null) return { ok: true, value: { agentRun, dispatchMarker: null } }

	const completedAgentRun = await updateRecord('agent-run', storage, agentRun.id, { completed })
	if (!completedAgentRun.ok) return completedAgentRun

	const dispatchMarker = await acceptAgentRunSandboxRelease(dispatcher, completedAgentRun.value.id)
	return dispatchMarker.ok
		? { ok: true, value: { agentRun: completedAgentRun.value, dispatchMarker: dispatchMarker.value } }
		: dispatchMarker
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedProject } = await import('./test-helpers')
	const { ensureGitRequirement, globalRuntimeRequirements } = await import('./agent-run-runtime-requirements')

	describe('createInstructedModelAgentRunAndRequestPreparation', () => {
		it('creates a Model Agent Run, records its instruction, and requests Agent Run preparation', async () => {
			const dispatches: unknown[] = []
			const options = createTestCoreServices({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return Promise.resolve('marker-1')
					},
					ready: () => {},
				},
			})
			const project = seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				agentRunId: '01k00000000000000000000002',
				title: 'Plan',
				created: localStamp(),
				closed: null,
			})

			const result = await createModelAgentRunAndRequestPreparation(
				{ values: options.values, dispatcher: options.dispatcher },
				options.storage,
				{
					agentRunId: '01k00000000000000000000002',
					agentRunProfile: {
						id: '01k00000000000000000000006',
						name: 'Planning',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [],
						sandboxConfig: defaultAgentRunSandboxConfig(),
						created: localStamp(),
						updated: null,
						archivePeriods: [],
					},
					project,
					purpose: { type: 'planning', planId: '01k00000000000000000000028' },
					started: { at: '2026-06-10T12:00:00.000Z' },
				},
			)

			const expectedAgentRun = {
				id: '01k00000000000000000000002',
				agent: { type: 'model' },
				purpose: { type: 'planning', planId: '01k00000000000000000000028' },
				profile: {
					agentRunProfileId: '01k00000000000000000000006',
					name: 'Planning',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					runtimeRequirements: [],
					sandboxConfig: defaultAgentRunSandboxConfig(),
				},
				toolSet: toolSet(['read', 'grep', 'find', 'ls', 'propose-plan-output']),
				modelUseOverride: null,
				sourceRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [...globalRuntimeRequirements, ensureGitRequirement],
				blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: null,
				started: { at: '2026-06-10T12:00:00.000Z' },
				completed: null,
			}
			expect(result).toEqual({
				ok: true,
				value: {
					agentRun: expectedAgentRun,
					instructionEvent: {
						id: '01k00000000000000000010001',
						agentRunId: '01k00000000000000000000002',
						occurred: { at: '2026-06-10T12:00:00.000Z' },
						body: instructionForProjectAndAgentRunPurpose({ type: 'planning', planId: '01k00000000000000000000028' }, project),
					},
					preparationDispatchMarker: 'marker-1',
				},
			})
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toEqual(expectedAgentRun)
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010001')).toEqual(
				result.ok ? result.value.instructionEvent : null,
			)
			expect(dispatches).toEqual([
				{
					type: 'agent-run-preparation',
					agentRunId: '01k00000000000000000000002',
					coordinationClaims: [
						{
							scope: [{ type: 'agent-run', id: '01k00000000000000000000002' }],
							mode: { type: 'exclusive' },
						},
					],
					reason: { type: 'agent-run-created' },
				},
			])
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
					sandboxConfig: defaultAgentRunSandboxConfig(),
				},
				toolSet: [],
				modelUseOverride: null,
				sourceRuntimeRequirements: [],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [],
				blocked: { type: 'preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: null,
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

	function toolSet(names: string[]): AgentRunToolSet {
		return names.map((name) => ({ name, contractVersion: 1 }))
	}
}
