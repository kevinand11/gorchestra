import { resolveAgentRunSourceRuntimeRequirements, type ResolveAgentRunSourceRuntimeRequirementsError } from './agent-run-source-resolvers'
import { validateRuntimeRequirementSecretReferences, type RuntimeRequirementSecretReferenceError } from './runtime-requirement-secrets'
import { nextId, runtimeRecord, type CoreRuntimeValues } from './runtime-values'
import type { Result } from './types'
import { acceptAgentRunPreparation, acceptAgentRunSandboxRelease } from '../commands/utils/dispatch'
import type { AgentRun, AgentRunEvent, AgentRunEventBody, AgentRunProfileSnapshot, AgentRunPurpose } from '../domain/agent-run'
import { appendUniqueRuntimeRequirements, type AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import type { Id, RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { createRecord, getRequired, listRecords, updateRecord } from '../storage/helpers'

export type AgentRunLookupError = InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError
export type AgentRunCompletionError = AgentRunLookupError | ResourceNotFoundError

export function agentRunSandboxPrepared(agentRun: AgentRun): boolean {
	return (
		agentRun.sandbox !== null &&
		agentRun.sandbox.released === null &&
		agentRun.blocked === null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughEventId === latestRuntimeRequirementOverrideEventId(agentRun)
	)
}

export async function getSingleAgentRunByPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<AgentRun, AgentRunLookupError>> {
	const agentRuns = await listRecords('agent-run', storage, { where: (filter, fields) => filter.eq(fields.purpose, purpose) })
	return agentRuns.ok ? singleAgentRunByPurpose(agentRuns.value, purpose) : agentRuns
}

export async function completeSingleAgentRunByPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
	completed: RuntimeRecord,
): Promise<Result<AgentRun, AgentRunCompletionError>> {
	const agentRun = await getSingleAgentRunByPurpose(storage, purpose)
	if (!agentRun.ok) return agentRun

	return agentRun.value.completed === null
		? updateRecord('agent-run', storage, agentRun.value.id, { completed })
		: { ok: true, value: agentRun.value }
}

function latestRuntimeRequirementOverrideEventId(agentRun: AgentRun): string | null {
	return agentRun.runtimeRequirementOverrides.at(-1)?.eventId ?? null
}

function singleAgentRunByPurpose(agentRuns: AgentRun[], purpose: AgentRunPurpose): Result<AgentRun, InvariantViolationError> {
	const purposeKey = agentRunPurposeKey(purpose)
	const matching = agentRuns.filter((agentRun) => agentRunPurposeKey(agentRun.purpose) === purposeKey)
	return matching.length === 1 ? { ok: true, value: matching[0]! } : agentRunCountInvariant(purpose, matching.length)
}

function agentRunPurposeKey(purpose: AgentRunPurpose): string {
	return `${purpose.type}:${JSON.stringify(purpose)}`
}

function agentRunCountInvariant(purpose: AgentRunPurpose, count: number): Result<never, InvariantViolationError> {
	return invariant(`Expected exactly one Agent Run for ${agentRunPurposeDescription(purpose)} but found ${count}.`)
}

function agentRunPurposeDescription(purpose: AgentRunPurpose): string {
	return `${purpose.type} ${agentRunPurposeKey(purpose)}`
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
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

export type CreateModelAgentRunError =
	| AppendAgentRunEventError
	| ResolveAgentRunSourceRuntimeRequirementsError
	| RuntimeRequirementSecretReferenceError

export async function createInstructedModelAgentRunAndRequestPreparation<TPurpose extends AgentRunPurpose>(
	context: { values: CoreRuntimeValues; dispatcher: CoreServices['dispatcher'] },
	storage: CoreStorage,
	input: {
		agentRunId: Id
		purpose: TPurpose
		started: RuntimeRecord
		profile: AgentRunProfileSnapshot
		instruction: Extract<AgentRunEvent['body'], { type: 'instruction-snapshot' }>
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
	const sourceRuntimeRequirements = await resolveAgentRunSourceRuntimeRequirements(storage, input.purpose)
	if (!sourceRuntimeRequirements.ok) return sourceRuntimeRequirements

	const sourceSecretValidation = await validateRuntimeRequirementSecretReferences(storage, sourceRuntimeRequirements.value)
	if (!sourceSecretValidation.ok) return sourceSecretValidation

	const agentRun = modelAgentRun({ ...input, sourceRuntimeRequirements: sourceRuntimeRequirements.value })
	const stored = await createRecord('agent-run', storage, agentRun)
	if (!stored.ok) return stored

	const instructionEvent = await appendAgentRunEvent({ values: context.values }, storage, agentRun.id, input.instruction)
	if (!instructionEvent.ok) return instructionEvent

	const preparationDispatchMarker = await acceptAgentRunPreparation(context.dispatcher, agentRun.id, { type: 'agent-run-created' })
	return preparationDispatchMarker.ok
		? {
				ok: true,
				value: {
					agentRun,
					instructionEvent: instructionEvent.value,
					preparationDispatchMarker: preparationDispatchMarker.value,
				},
			}
		: preparationDispatchMarker
}

function modelAgentRun<TPurpose extends AgentRunPurpose>(input: {
	agentRunId: Id
	purpose: TPurpose
	started: RuntimeRecord
	profile: AgentRunProfileSnapshot
	sourceRuntimeRequirements: AgentRunRuntimeRequirement[]
}): ModelAgentRunWithPurpose<TPurpose> {
	const desiredRuntimeRequirements = appendUniqueRuntimeRequirements(input.sourceRuntimeRequirements, input.profile.runtimeRequirements)
	return {
		id: input.agentRunId,
		agent: { type: 'model' },
		purpose: input.purpose,
		profile: input.profile,
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

export async function completeAgentRunByPurposeAndAcceptSandboxRelease(
	storage: CoreStorage,
	dispatcher: CoreServices['dispatcher'],
	purpose: AgentRunPurpose,
	completed: RuntimeRecord,
): Promise<Result<{ agentRun: AgentRun; dispatchMarker: string | null }, AgentRunCompletionError | InvalidCoreServiceOutputError>> {
	const current = await getSingleAgentRunByPurpose(storage, purpose)
	if (!current.ok) return current
	if (current.value.completed !== null) return { ok: true, value: { agentRun: current.value, dispatchMarker: null } }

	const agentRun = await completeSingleAgentRunByPurpose(storage, purpose, completed)
	if (!agentRun.ok) return agentRun

	const dispatchMarker = await acceptAgentRunSandboxRelease(dispatcher, agentRun.value.id)
	return dispatchMarker.ok ? { ok: true, value: { agentRun: agentRun.value, dispatchMarker: dispatchMarker.value } } : dispatchMarker
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, defaultAgentRunSandboxConfig, localStamp, seedProject } = await import('./test-helpers')

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
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.plans.records.set('01k00000000000000000000028', {
				id: '01k00000000000000000000028',
				projectId: '01k00000000000000000000030',
				title: 'Plan',
				created: localStamp(),
				closed: null,
			})

			const result = await createInstructedModelAgentRunAndRequestPreparation(
				{ values: options.values, dispatcher: options.dispatcher },
				options.storage,
				{
					agentRunId: '01k00000000000000000000002',
					purpose: { type: 'planning', planId: '01k00000000000000000000028' },
					started: { at: '2026-06-10T12:00:00.000Z' },
					profile: {
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Planning',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [],
						sandboxConfig: defaultAgentRunSandboxConfig(),
					},
					instruction: {
						type: 'instruction-snapshot',
						instruction: { type: 'source-control-planning', version: 1 },
						parts: [{ type: 'text', text: 'Instruction.', metadata: null }],
					},
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
				modelUseOverride: null,
				sourceRuntimeRequirements: [],
				runtimeRequirementOverrides: [],
				desiredRuntimeRequirements: [],
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
						body: {
							type: 'instruction-snapshot',
							instruction: { type: 'source-control-planning', version: 1 },
							parts: [{ type: 'text', text: 'Instruction.', metadata: null }],
						},
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

		it('returns source resolution errors without storing partial Agent Run facts', async () => {
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

			const result = await createInstructedModelAgentRunAndRequestPreparation(
				{ values: options.values, dispatcher: options.dispatcher },
				options.storage,
				{
					agentRunId: '01k00000000000000000000002',
					purpose: { type: 'planning', planId: '01k00000000000000000000028' },
					started: { at: '2026-06-10T12:00:00.000Z' },
					profile: {
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Planning',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [],
						sandboxConfig: defaultAgentRunSandboxConfig(),
					},
					instruction: {
						type: 'instruction-snapshot',
						instruction: { type: 'source-control-planning', version: 1 },
						parts: [{ type: 'text', text: 'Instruction.', metadata: null }],
					},
				},
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'plan', id: '01k00000000000000000000028' } })
			expect(options.tx.agentRuns.records.size).toBe(0)
			expect(options.tx.agentRunEvents.records.size).toBe(0)
			expect(dispatches).toEqual([])
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
}
