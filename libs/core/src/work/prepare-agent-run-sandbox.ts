import { v, type PipeInput, type PipeOutput } from 'valleyed'

import type { WorkContext } from './types'
import { buildWorkHandler } from './utils/handler'
import type { AgentRun } from '../domain/agent-run'
import { runtimeRequirementKey, type AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import { idPipe, type Id } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SecretNotActiveError,
	SecretResolutionFailedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { managedSandboxProviderForConfig, type SandboxProviderResolutionError } from '../runtime/sandboxes'
import type { ManagedSandbox, ManagedSandboxError, ManagedSandboxProvider } from '../runtime/sandboxes/managed'
import type { SandboxCommandOutput } from '../services'
import { getRequired, updateRecord } from '../storage/helpers'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { agentRunSandboxPrepared } from '../utils/agent-runs'
import { runtimeRecord } from '../utils/runtime-values'
import { resolveActiveSecretValues } from '../utils/secret-values'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

const inputPipe = v.object({ agentRunId: idPipe })
type ParsedInput = PipeOutput<typeof inputPipe>
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>
export type Result = void
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

const defaultSandboxCommandTimeoutMs = 10 * 60 * 1000

type SandboxPreparationFailureTarget = Extract<NonNullable<AgentRun['blocked']>, { type: 'sandbox-preparation-failed' }>['target']
type AgentRunSandbox = NonNullable<AgentRun['sandbox']>
type AgentRunWithSandbox = AgentRun & { sandbox: AgentRunSandbox }

export function createPrepareAgentRunSandboxOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('prepareAgentRunSandbox', inputPipe, (input: ParsedInput) => prepareAgentRunSandbox(runtime, input.agentRunId))
}

async function prepareAgentRunSandbox(runtime: CoreRuntime, agentRunId: Id): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const loaded = await getRequired('agent-run', runtime.services.storage, agentRunId)
	if (!loaded.ok) return loaded
	if (loaded.value.completed !== null) return { ok: true, value: undefined }

	const preparedSandbox = await ensureManagedSandbox(runtime, loaded.value)
	if (!preparedSandbox.ok) {
		if (isCommandPreparationFailure(preparedSandbox.error)) {
			const blocked = await blockPreparationFailure(runtime, loaded.value, { type: 'sandbox' }, preparedSandbox.error.summary)
			return blocked.ok ? { ok: true, value: undefined } : blocked
		}
		return { ok: false, error: preparedSandbox.error }
	}
	if (preparedSandbox.value.agentRun.completed !== null) return { ok: true, value: undefined }
	if (agentRunSandboxPrepared(preparedSandbox.value.agentRun)) return { ok: true, value: undefined }

	const started = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
		type: 'agent-run-sandbox-preparation-started',
		requestedThroughEventId: latestRuntimeOverrideEventId(preparedSandbox.value.agentRun),
	})
	if (!started.ok) return started

	return applyRuntimeRequirements(runtime, preparedSandbox.value.agentRun, preparedSandbox.value.sandbox)
}

async function ensureManagedSandbox(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<
	CoreResult<{ agentRun: AgentRunWithSandbox; sandbox: ManagedSandbox }, CommandPreparationFailure | Exclude<Error, InvalidInputError>>
> {
	if (agentRun.sandbox !== null && agentRun.sandbox.released !== null) {
		return invariant(`Agent Run ${agentRun.id} sandbox has already been released.`)
	}

	const provider = await resolveManagedSandboxProviderForPreparation(runtime, agentRun)
	if (!provider.ok) return provider

	if (agentRun.sandbox === null) {
		const key = agentRun.id
		const createdSandbox = await provider.value.create({ key, config: agentRun.profile.sandboxConfig })
		if (!createdSandbox.ok) return mapManagedSandboxError(createdSandbox.error)

		const createdAgentRun = await recordSandboxCreated(runtime, agentRun, key)
		return createdAgentRun.ok
			? { ok: true, value: { agentRun: createdAgentRun.value, sandbox: createdSandbox.value } }
			: createdAgentRun
	}

	const existingAgentRun = requireAgentRunSandbox(agentRun)
	if (!existingAgentRun.ok) return existingAgentRun

	const found = await provider.value.find({ key: existingAgentRun.value.sandbox.key })
	if (!found.ok) return mapManagedSandboxError(found.error)
	return found.value === null
		? { ok: false, error: { summary: 'Agent Run sandbox was not found.' } }
		: { ok: true, value: { agentRun: existingAgentRun.value, sandbox: found.value } }
}

async function recordSandboxCreated(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	key: string,
): Promise<CoreResult<AgentRunWithSandbox, Exclude<Error, InvalidInputError>>> {
	const created = runtimeRecord(runtime.values)
	if (!created.ok) return created

	const agentRunSandbox: AgentRunSandbox = {
		key,
		created: created.value,
		released: null,
		appliedRequirements: [],
		appliedThroughEventId: null,
	}
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox: agentRunSandbox })
	if (!updated.ok) return updated

	const updatedAgentRun = requireAgentRunSandbox(updated.value)
	if (!updatedAgentRun.ok) return updatedAgentRun

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-created',
		key,
	})
	return event.ok ? { ok: true, value: updatedAgentRun.value } : event
}

async function applyRuntimeRequirements(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	sandbox: ManagedSandbox,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const prefix = validateAppliedRequirementPrefix(agentRun)
	if (!prefix.ok) return prefix

	let current = agentRun
	for (let index = current.sandbox.appliedRequirements.length; index < current.desiredRuntimeRequirements.length; index += 1) {
		const requirement = current.desiredRuntimeRequirements[index]!
		const applied = await applyRuntimeRequirement(runtime, current, sandbox, index, requirement)
		if (!applied.ok) return applied
		if (!applied.value.applied) return { ok: true, value: undefined }
		current = applied.value.agentRun
	}

	const completed = await completePreparation(runtime, current)
	return completed.ok ? { ok: true, value: undefined } : completed
}

type ApplyRequirementResult = { applied: true; agentRun: AgentRunWithSandbox } | { applied: false }

async function applyRuntimeRequirement(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	sandbox: ManagedSandbox,
	index: number,
	requirement: AgentRunRuntimeRequirement,
): Promise<CoreResult<ApplyRequirementResult, Exclude<Error, InvalidInputError>>> {
	const operation = await operationForRuntimeRequirement(runtime, requirement)
	if (!operation.ok) {
		return isCommandPreparationFailure(operation.error)
			? blockRuntimeRequirementFailure(runtime, agentRun, index, requirement, operation.error.summary)
			: { ok: false, error: operation.error }
	}

	const execution = await runPreparedSandboxOperation(sandbox, operation.value)
	if (!execution.ok) {
		return execution.error.type === 'sandbox-operation-failed'
			? blockRuntimeRequirementFailure(runtime, agentRun, index, requirement, execution.error.summary)
			: { ok: false, error: execution.error }
	}
	if (execution.value.exitCode !== 0)
		return blockRuntimeRequirementFailure(runtime, agentRun, index, requirement, execution.value.summary)

	return recordAppliedRuntimeRequirement(runtime, agentRun, requirement)
}

async function blockRuntimeRequirementFailure(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	index: number,
	requirement: AgentRunRuntimeRequirement,
	summary: string,
): Promise<CoreResult<ApplyRequirementResult, Exclude<Error, InvalidInputError>>> {
	const blocked = await blockPreparationFailure(runtime, agentRun, { type: 'runtime-requirement', index, requirement }, summary)
	return blocked.ok ? { ok: true, value: { applied: false } } : blocked
}

async function recordAppliedRuntimeRequirement(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
	requirement: AgentRunRuntimeRequirement,
): Promise<CoreResult<ApplyRequirementResult, Exclude<Error, InvalidInputError>>> {
	const nextSandbox = { ...agentRun.sandbox, appliedRequirements: [...agentRun.sandbox.appliedRequirements, requirement], released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox: nextSandbox })
	if (!updated.ok) return updated

	const updatedAgentRun = requireAgentRunSandbox(updated.value)
	return updatedAgentRun.ok ? { ok: true, value: { applied: true, agentRun: updatedAgentRun.value } } : updatedAgentRun
}

function requireAgentRunSandbox(agentRun: AgentRun): CoreResult<AgentRunWithSandbox, InvariantViolationError> {
	return agentRun.sandbox === null
		? invariant(`Agent Run ${agentRun.id} sandbox was expected to exist.`)
		: { ok: true, value: agentRun as AgentRunWithSandbox }
}

function validateAppliedRequirementPrefix(agentRun: AgentRunWithSandbox): CoreResult<void, InvariantViolationError> {
	for (const [index, requirement] of agentRun.sandbox.appliedRequirements.entries()) {
		const desired = agentRun.desiredRuntimeRequirements[index]
		if (desired === undefined || runtimeRequirementKey(requirement) !== runtimeRequirementKey(desired)) {
			return invariant(`Agent Run ${agentRun.id} sandbox applied requirements do not match desired requirements.`)
		}
	}
	return { ok: true, value: undefined }
}

function invariant(message: string): CoreResult<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

type PreparedSandboxOperation =
	| { type: 'set-env'; label: string; envName: string; value: string }
	| {
			type: 'run-command'
			label: string
			command: { executable: string; args: string[]; cwd: string | null }
			commandSecretEnv: Record<string, string>
	  }

type CommandPreparationFailure = { summary: string }

function isCommandPreparationFailure(
	error: CommandPreparationFailure | ManagedSandboxError | Exclude<Error, InvalidInputError>,
): error is CommandPreparationFailure {
	return 'summary' in error && !('type' in error)
}

async function operationForRuntimeRequirement(
	runtime: CoreRuntime,
	requirement: AgentRunRuntimeRequirement,
): Promise<CoreResult<PreparedSandboxOperation, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	switch (requirement.type) {
		case 'environment-secret': {
			const plaintext = await resolveSecretPlaintext(runtime, requirement.secretId)
			return plaintext.ok
				? {
						ok: true,
						value: {
							type: 'set-env',
							label: `Set environment variable ${requirement.envName}`,
							envName: requirement.envName,
							value: plaintext.value,
						},
					}
				: plaintext
		}
		case 'run-command': {
			const commandSecretEnv = await resolveCommandSecretEnv(runtime, requirement.commandSecretEnv)
			return commandSecretEnv.ok
				? {
						ok: true,
						value: {
							type: 'run-command',
							label: requirement.label,
							command: requirement.command,
							commandSecretEnv: commandSecretEnv.value,
						},
					}
				: commandSecretEnv
		}
		default:
			throw new Error(`Unexpected Agent Run Runtime Requirement type: ${String(requirement satisfies never)}`)
	}
}

async function resolveCommandSecretEnv(
	runtime: CoreRuntime,
	commandSecretEnv: Record<string, string>,
): Promise<CoreResult<Record<string, string>, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const entries = Object.entries(commandSecretEnv)
	const secretValues = await resolveSecretPlaintexts(
		runtime,
		entries.map(([, secretId]) => secretId),
	)
	if (!secretValues.ok) return secretValues

	const resolvedEntries: Array<[string, string]> = []
	for (const [envName, secretId] of entries) {
		const value = secretValues.value[secretId]
		if (value === undefined) return { ok: false, error: { summary: `Secret ${secretId} could not be resolved.` } }
		resolvedEntries.push([envName, value])
	}
	return { ok: true, value: Object.fromEntries(resolvedEntries) }
}

async function resolveSecretPlaintext(
	runtime: CoreRuntime,
	secretId: Id,
): Promise<CoreResult<string, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const values = await resolveSecretPlaintexts(runtime, [secretId])
	if (!values.ok) return values
	const value = values.value[secretId]
	return value === undefined ? { ok: false, error: { summary: `Secret ${secretId} could not be resolved.` } } : { ok: true, value }
}

async function resolveSecretPlaintexts(
	runtime: CoreRuntime,
	secretIds: Id[],
): Promise<CoreResult<Record<Id, string>, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const resolution = await resolveActiveSecretValues(runtime.services, runtime.services.storage, secretIds)
	if (!resolution.ok) return resolution

	const plaintexts: Record<Id, string> = {}
	for (const [secretId, value] of Object.entries(resolution.value)) {
		if (!value.ok) return { ok: false, error: { summary: secretResolutionSummary(secretId, value.error) } }
		plaintexts[secretId] = value.value
	}
	return { ok: true, value: plaintexts }
}

function secretResolutionSummary(secretId: Id, error: ResourceNotFoundError | SecretNotActiveError | SecretResolutionFailedError): string {
	if (error.type === 'secret-not-active') return `Secret ${secretId} is archived.`
	return `Secret ${secretId} could not be resolved.`
}

function runPreparedSandboxOperation(
	sandbox: ManagedSandbox,
	operation: PreparedSandboxOperation,
): Promise<CoreResult<SandboxCommandOutput, ManagedSandboxError>> {
	switch (operation.type) {
		case 'set-env':
			return sandbox.setEnv({ name: operation.envName, value: operation.value })
		case 'run-command':
			return sandbox.runCommand({
				label: operation.label,
				command: operation.command,
				commandSecretEnv: operation.commandSecretEnv,
				timeoutMs: defaultSandboxCommandTimeoutMs,
			})
		default:
			throw new Error(`Unexpected prepared sandbox operation: ${String(operation satisfies never)}`)
	}
}

async function resolveManagedSandboxProviderForPreparation(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<ManagedSandboxProvider, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const sandboxProvider = await managedSandboxProviderForConfig(runtime, runtime.services.storage, agentRun.profile.sandboxConfig)
	return sandboxProvider.ok ? sandboxProvider : mapSandboxProviderResolutionError(sandboxProvider.error)
}

function mapSandboxProviderResolutionError(
	error: SandboxProviderResolutionError,
): CoreResult<never, CommandPreparationFailure | Exclude<Error, InvalidInputError>> {
	return error.type === 'sandbox-provider-resolution-failed' ? { ok: false, error: { summary: error.summary } } : { ok: false, error }
}

function mapManagedSandboxError(error: ManagedSandboxError): CoreResult<never, CommandPreparationFailure | InvalidCoreServiceOutputError> {
	return error.type === 'sandbox-operation-failed' ? { ok: false, error: { summary: error.summary } } : { ok: false, error }
}

async function completePreparation(
	runtime: CoreRuntime,
	agentRun: AgentRunWithSandbox,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	const appliedThroughEventId = latestRuntimeOverrideEventId(agentRun)
	const sandbox = { ...agentRun.sandbox, appliedThroughEventId, released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { blocked: null, sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-preparation-completed',
		appliedThroughEventId,
		summary: 'Agent Run sandbox preparation completed.',
	})
	return event.ok ? { ok: true, value: updated.value } : event
}

async function blockPreparationFailure(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	target: SandboxPreparationFailureTarget,
	summary: string,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	const blockedRecord = runtimeRecord(runtime.values)
	if (!blockedRecord.ok) return blockedRecord

	const blocked: AgentRun['blocked'] = { type: 'sandbox-preparation-failed', blocked: blockedRecord.value, target, summary }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { blocked })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-preparation-failed',
		target,
		summary,
	})
	return event.ok ? { ok: true, value: { ...agentRun, blocked } } : event
}

function latestRuntimeOverrideEventId(agentRun: AgentRun): Id | null {
	return agentRun.runtimeRequirementOverrides.at(-1)?.eventId ?? null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, seedSecret, testModelAgentRun } =
		await import('../utils/test-helpers')

	describe('prepareAgentRunSandbox work operation', () => {
		it('validates input with the work boundary before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '' }, { correlationId: null })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'work', operation: 'prepareAgentRunSandbox' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a sandbox by key and applies environment Secret requirements through managed setEnv', async () => {
			const files = new Map<string, string>()
			const commands: unknown[] = []
			const sandboxes = new Map<string, ReturnType<typeof rawSandbox>>()
			const options = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: () => Promise.resolve({ '01k00000000000000000000040': 'plaintext-token' }),
				},
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) => {
						const sandbox = rawSandbox(files, commands)
						sandboxes.set(key, sandbox)
						return Promise.resolve(sandbox)
					},
					find: ({ key }) => Promise.resolve(sandboxes.get(key) ?? null),
				},
			})
			seedSecret(options.tx, '01k00000000000000000000040')
			options.tx.agentRuns.records.set(
				'01k00000000000000000000002',
				testModelAgentRun({
					profile: {
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Agent Run Profile',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						runtimeRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
						sandboxConfig: defaultAgentRunSandboxConfig(),
					},
				}),
			)
			options.tx.agentRuns.records.get('01k00000000000000000000002')!.desiredRuntimeRequirements = [
				{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' },
			]
			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })

			expect(result).toEqual({ ok: true, value: undefined })
			expect(commands).toEqual([])
			expect(files.get('/workspace/.gorchestra/runtime-env.json')).toBe(`${JSON.stringify({ NPM_TOKEN: 'plaintext-token' })}\n`)
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')).toMatchObject({
				blocked: null,
				sandbox: {
					key: '01k00000000000000000000002',
					created: { at: '2026-06-10T12:00:00.000Z' },
					appliedRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
					appliedThroughEventId: null,
					released: null,
				},
			})
		})

		it('blocks with sandbox target when provider sandbox creation fails', async () => {
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.reject(new Error('provider unavailable')),
					find: () => Promise.resolve(null),
				},
			})
			options.tx.agentRuns.records.set('01k00000000000000000000002', testModelAgentRun())
			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })

			expect(result).toEqual({ ok: true, value: undefined })
			expect(options.tx.agentRuns.records.get('01k00000000000000000000002')?.blocked).toMatchObject({
				type: 'sandbox-preparation-failed',
				target: { type: 'sandbox' },
				summary: 'Sandbox creation failed.',
			})
			expect(Array.from(options.tx.agentRunEvents.records.values()).at(-1)?.body).toMatchObject({
				type: 'agent-run-sandbox-preparation-failed',
				target: { type: 'sandbox' },
				summary: 'Sandbox creation failed.',
			})
		})

		it('returns invariant violations when applied requirements are not a desired requirements prefix', async () => {
			const sandbox = rawSandbox(new Map(), [])
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(sandbox),
					find: () => Promise.resolve(sandbox),
				},
			})
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...testModelAgentRun(),
				blocked: { type: 'sandbox-preparation-pending', blocked: { at: '2026-06-10T12:00:00.000Z' } },
				sandbox: {
					key: '01k00000000000000000000002',
					created: { at: '2026-06-10T12:00:00.000Z' },
					appliedRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
					appliedThroughEventId: null,
					released: null,
				},
				desiredRuntimeRequirements: [
					{ type: 'environment-secret', envName: 'GITHUB_TOKEN', secretId: '01k00000000000000000000040' },
				],
			})
			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Agent Run 01k00000000000000000000002 sandbox applied requirements do not match desired requirements.',
				},
			})
		})

		it('reuses one managed sandbox handle for remaining runtime requirements', async () => {
			const files = new Map<string, string>()
			const commands: unknown[] = []
			let findCalls = 0
			const sandbox = rawSandbox(files, commands)
			const options = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: () => Promise.resolve({ '01k00000000000000000000040': 'prepared-token' }),
				},
				sandbox: {
					kind: 'consumer-managed',
					create: () => Promise.resolve(sandbox),
					find: () => {
						findCalls += 1
						return Promise.resolve(sandbox)
					},
				},
			})
			seedSecret(options.tx, '01k00000000000000000000040')
			options.tx.agentRuns.records.set('01k00000000000000000000002', {
				...testModelAgentRun(),
				sandbox: {
					key: '01k00000000000000000000002',
					created: { at: '2026-06-10T12:00:00.000Z' },
					appliedRequirements: [],
					appliedThroughEventId: null,
					released: null,
				},
				desiredRuntimeRequirements: [
					{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' },
					{
						type: 'run-command',
						label: 'Install',
						command: { executable: 'npm', args: ['install'], cwd: '/workspace' },
						commandSecretEnv: {},
					},
				],
			})
			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '01k00000000000000000000002' }, { correlationId: null })

			expect(result).toEqual({ ok: true, value: undefined })
			expect(findCalls).toBe(1)
			expect(commands).toEqual([
				{
					command: { executable: 'npm', args: ['install'], cwd: '/workspace' },
					env: { NPM_TOKEN: 'prepared-token' },
					timeoutMs: 600_000,
				},
			])
		})
	})

	function rawSandbox(files: Map<string, string>, commands: unknown[]) {
		return {
			runCommand: (input: unknown) => {
				commands.push(input)
				return Promise.resolve({ exitCode: 0, summary: 'Command completed.', stdout: null, stderr: null })
			},
			readFile: (path: string) => Promise.resolve(files.get(path) ?? null),
			writeFile: (path: string, contents: string) => {
				files.set(path, contents)
				return Promise.resolve()
			},
			release: () => Promise.resolve({ summary: 'released' }),
		}
	}
}
