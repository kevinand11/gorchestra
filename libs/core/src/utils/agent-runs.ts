import { resolveAgentRunSourceSetup } from './agent-run-source-resolvers'
import { agentRunProfileSnapshot } from './command-storage'
import { acceptAgentRunPreparation, acceptAgentRunSandboxRelease } from './dispatch'
import type { NotificationEmitter } from './notifications'
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
	context: { values: CoreRuntimeValues; dispatcher: CoreServices['dispatcher']; notifications: NotificationEmitter },
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
	const stored = await createAgentRunRecord(storage, context.notifications, agentRun)
	if (!stored.ok) return stored

	const instruction = instructionForProjectAndAgentRunPurpose(agentRun.purpose, input.project)
	const instructionEvent = await appendAgentRunEvent(context, storage, agentRun.id, instruction)
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

export async function createAgentRunRecord(
	storage: CoreStorage,
	notifications: NotificationEmitter,
	agentRun: AgentRun,
): Promise<Result<AgentRun, StorageOperationFailedError | InvariantViolationError>> {
	const created = await createRecord('agent-run', storage, agentRun)
	if (!created.ok) return created

	notifications.emit({ type: 'agent-run-created', agentRun: created.value })
	return created
}

export async function updateAgentRunRecord(
	storage: CoreStorage,
	notifications: NotificationEmitter,
	agentRunId: Id,
	patch: Partial<AgentRun>,
): Promise<Result<AgentRun, StorageOperationFailedError | ResourceNotFoundError | InvariantViolationError>> {
	const updated = await updateRecord('agent-run', storage, agentRunId, patch)
	if (!updated.ok) return updated

	notifications.emit({ type: 'agent-run-updated', agentRun: updated.value })
	return updated
}

export async function appendAgentRunEvent(
	context: { values: CoreRuntimeValues; notifications: NotificationEmitter },
	storage: CoreStorage,
	agentRunId: Id,
	body: AgentRunEventBody,
): Promise<Result<AgentRunEvent, AppendAgentRunEventError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const facts = agentRunEventFacts(context.values)
	if (!facts.ok) return facts

	const created = await createRecord('agent-run-event', storage, agentRunEventRecord(agentRunId, facts.value, body))
	if (!created.ok) return created

	context.notifications.emit({ type: 'agent-run-event-created', event: created.value })
	return created
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
	notifications: NotificationEmitter,
	agentRunId: Id,
	completed: RuntimeRecord,
): Promise<Result<{ agentRun: AgentRun; dispatchMarker: string | null }, AgentRunByIdCompletionError | InvalidCoreServiceOutputError>> {
	const current = await getRequired('agent-run', storage, agentRunId)
	if (!current.ok) return current

	const agentRun = current.value
	if (agentRun.completed !== null) return { ok: true, value: { agentRun, dispatchMarker: null } }

	const completedAgentRun = await updateAgentRunRecord(storage, notifications, agentRun.id, { completed })
	if (!completedAgentRun.ok) return completedAgentRun

	const dispatchMarker = await acceptAgentRunSandboxRelease(dispatcher, completedAgentRun.value.id)
	return dispatchMarker.ok
		? { ok: true, value: { agentRun: completedAgentRun.value, dispatchMarker: dispatchMarker.value } }
		: dispatchMarker
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedProject, testModelAgentRun } =
		await import('./test-helpers')
	const { ensureGitRequirement, globalRuntimeRequirements } = await import('./agent-run-runtime-requirements')

	describe('createInstructedModelAgentRunAndRequestPreparation', () => {
		it('creates a Model Agent Run, records its instruction, and requests Agent Run preparation', async () => {
			const dispatches: unknown[] = []
			const notifications: unknown[] = []
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
				{ values: options.values, dispatcher: options.dispatcher, notifications: { emit: (data) => notifications.push(data) } },
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
			expect(notifications).toEqual([
				{ type: 'agent-run-created', agentRun: expectedAgentRun },
				{ type: 'agent-run-event-created', event: result.ok ? result.value.instructionEvent : null },
			])
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

	describe('Agent Run storage notifications', () => {
		it('publishes the complete post-write Agent Run after an update', async () => {
			const options = createTestCoreServices()
			const agentRun = testModelAgentRun()
			options.tx.agentRuns.records.set(agentRun.id, agentRun)
			const notifications: unknown[] = []

			const updated = await updateAgentRunRecord(options.storage, { emit: (data) => notifications.push(data) }, agentRun.id, {
				blocked: null,
			})

			expect(updated).toMatchObject({ ok: true, value: { id: agentRun.id, blocked: null } })
			expect(notifications).toEqual([{ type: 'agent-run-updated', agentRun: updated.ok ? updated.value : null }])
		})

		it('does not publish failed Agent Run or Agent Run Event writes', async () => {
			const options = createTestCoreServices()
			const agentRun = testModelAgentRun()
			options.tx.agentRuns.records.set(agentRun.id, agentRun)
			options.tx.agentRuns.fail.put = true
			const notifications: unknown[] = []
			const emitter = { emit: (data: unknown) => notifications.push(data) }

			const duplicate = await createAgentRunRecord(options.storage, emitter, agentRun)
			const missingUpdate = await updateAgentRunRecord(options.storage, emitter, '01k00000000000000000000099', { blocked: null })
			const missingAppend = await appendAgentRunEvent(
				{ values: options.values, notifications: emitter },
				options.storage,
				'01k00000000000000000000099',
				{ type: 'interrupt-requested', source: { type: 'runtime' }, reason: null },
			)

			expect([duplicate.ok, missingUpdate.ok, missingAppend.ok]).toEqual([false, false, false])
			expect(notifications).toEqual([])
		})
	})

	describe('completeAgentRunByIdAndAcceptSandboxRelease', () => {
		it('publishes only the newly completed Agent Run snapshot', async () => {
			const options = createTestCoreServices()
			const active = testModelAgentRun()
			const completed = testModelAgentRun({ id: '01k00000000000000000000003', completed: { at: '2026-06-09T12:00:00.000Z' } })
			options.tx.agentRuns.records.set(active.id, active)
			options.tx.agentRuns.records.set(completed.id, completed)
			const notifications: unknown[] = []
			const emitter = { emit: (data: unknown) => notifications.push(data) }

			const first = await completeAgentRunByIdAndAcceptSandboxRelease(options.storage, options.dispatcher, emitter, active.id, {
				at: '2026-06-10T12:00:00.000Z',
			})
			const second = await completeAgentRunByIdAndAcceptSandboxRelease(options.storage, options.dispatcher, emitter, completed.id, {
				at: '2026-06-10T12:00:00.000Z',
			})

			expect(first).toMatchObject({ ok: true, value: { agentRun: { id: active.id, completed: { at: '2026-06-10T12:00:00.000Z' } } } })
			expect(second).toEqual({ ok: true, value: { agentRun: completed, dispatchMarker: null } })
			expect(notifications).toEqual([{ type: 'agent-run-updated', agentRun: first.ok ? first.value.agentRun : null }])
		})
	})

	describe('appendAgentRunEvent', () => {
		it('appends Agent Run Events with monotonic cursors', async () => {
			const options = createTestCoreServices()
			const notifications: unknown[] = []
			const context = { values: options.values, notifications: { emit: (data: unknown) => notifications.push(data) } }
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

			const first = await appendAgentRunEvent(context, options.storage, '01k00000000000000000000002', {
				type: 'input-message',
				source: { type: 'runtime' },
				parts: [{ type: 'text', text: 'hello', metadata: null }],
			})
			const second = await appendAgentRunEvent(context, options.storage, '01k00000000000000000000002', {
				type: 'interrupt-requested',
				source: { type: 'runtime' },
				reason: null,
			})

			expect(first).toMatchObject({ ok: true, value: { id: '01k00000000000000000010001' } })
			expect(second).toMatchObject({ ok: true, value: { id: '01k00000000000000000010002' } })
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010001')).toMatchObject({ id: '01k00000000000000000010001' })
			expect(options.tx.agentRunEvents.records.get('01k00000000000000000010002')).toMatchObject({ id: '01k00000000000000000010002' })
			expect(notifications).toEqual([
				{ type: 'agent-run-event-created', event: first.ok ? first.value : null },
				{ type: 'agent-run-event-created', event: second.ok ? second.value : null },
			])
		})
	})

	function toolSet(names: string[]): AgentRunToolSet {
		return names.map((name) => ({ name, contractVersion: 1 }))
	}
}
