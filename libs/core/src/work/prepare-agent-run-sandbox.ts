import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { isArchived } from '../commands/utils/storage'
import type { AgentRun } from '../domain/agent-run'
import type { AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import { idPipe, type Id } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { sandboxRuntimeForConfig, type SandboxRuntimeResolutionError } from '../runtime/agent-runs/sandbox-runtime'
import { resolvedSecretValuesPipe, sandboxCommandOutputPipe, sandboxPipe, type SandboxRuntime } from '../services'
import { getRequired, updateRecord } from '../storage/helpers'
import { appendAgentRunEvent } from '../utils/agent-run-events'
import { runtimeRecord } from '../utils/runtime-values'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { validateCoreServiceOutput } from '../validation'
import type { WorkContext } from './types'
import { buildWorkHandler } from './utils/handler'

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

export function createPrepareAgentRunSandboxOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('prepareAgentRunSandbox', inputPipe, (input: ParsedInput) => prepareAgentRunSandbox(runtime, input.agentRunId))
}

export async function prepareAgentRunSandbox(
	runtime: CoreRuntime,
	agentRunId: Id,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const loaded = await getRequired('agent-run', runtime.services.storage, agentRunId)
	if (!loaded.ok) return loaded
	if (loaded.value.completed !== null) return { ok: true, value: undefined }

	const created = await ensureSandboxCreated(runtime, loaded.value)
	if (!created.ok) return created
	if (created.value.completed !== null) return { ok: true, value: undefined }

	if (isPrepared(created.value)) return { ok: true, value: undefined }

	const started = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
		type: 'agent-run-sandbox-preparation-started',
		requestedThroughEventId: latestRuntimeOverrideEventId(created.value),
	})
	if (!started.ok) return started

	return applyRuntimeRequirements(runtime, created.value)
}

async function ensureSandboxCreated(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	if (agentRun.sandbox.created !== null) return { ok: true, value: agentRun }

	const sandboxRuntime = await resolveSandboxRuntimeForPreparation(runtime, agentRun)
	if (!sandboxRuntime.ok) {
		if (isCommandPreparationFailure(sandboxRuntime.error)) {
			return blockPreparationFailure(runtime, agentRun, { type: 'source-checkout' }, sandboxRuntime.error.summary)
		}
		return { ok: false, error: sandboxRuntime.error }
	}

	let output: unknown
	try {
		output = await sandboxRuntime.value.create({ key: agentRun.sandbox.key, config: agentRun.profile.sandboxConfig })
	} catch {
		return blockPreparationFailure(runtime, agentRun, { type: 'source-checkout' }, 'Sandbox creation failed.')
	}

	const createdSandbox = validateCoreServiceOutput(sandboxPipe, output, 'sandbox', 'create')
	if (!createdSandbox.ok) return createdSandbox

	const created = runtimeRecord(runtime.values)
	if (!created.ok) return created

	const sandbox = { ...agentRun.sandbox, created: created.value, released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-created',
		key: agentRun.sandbox.key,
	})
	return event.ok ? { ok: true, value: { ...agentRun, sandbox } } : event
}

function isPrepared(agentRun: AgentRun): boolean {
	return (
		agentRun.blocked === null &&
		agentRun.sandbox.created !== null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughEventId === latestRuntimeOverrideEventId(agentRun)
	)
}

async function applyRuntimeRequirements(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	let current = agentRun
	for (let index = current.sandbox.appliedRequirements.length; index < current.desiredRuntimeRequirements.length; index += 1) {
		const requirement = current.desiredRuntimeRequirements[index]!
		const applied = await applyRuntimeRequirement(runtime, current, index, requirement)
		if (!applied.ok) return applied
		if (!applied.value.applied) return { ok: true, value: undefined }
		current = applied.value.agentRun
	}

	const completed = await completePreparation(runtime, current)
	return completed.ok ? { ok: true, value: undefined } : completed
}

type ApplyRequirementResult = { applied: true; agentRun: AgentRun } | { applied: false }

async function applyRuntimeRequirement(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	index: number,
	requirement: AgentRunRuntimeRequirement,
): Promise<CoreResult<ApplyRequirementResult, Exclude<Error, InvalidInputError>>> {
	const command = await commandForRuntimeRequirement(runtime, requirement)
	if (!command.ok) {
		if (isCommandPreparationFailure(command.error)) {
			const blocked = await blockPreparationFailure(
				runtime,
				agentRun,
				{ type: 'runtime-requirement', index, requirement },
				command.error.summary,
			)
			return blocked.ok ? { ok: true, value: { applied: false } } : blocked
		}
		return { ok: false, error: command.error }
	}

	const execution = await runSandboxCommand(runtime, agentRun, command.value)
	if (!execution.ok) return execution
	if (execution.value.exitCode !== 0) {
		const blocked = await blockPreparationFailure(
			runtime,
			agentRun,
			{ type: 'runtime-requirement', index, requirement },
			execution.value.summary,
		)
		return blocked.ok ? { ok: true, value: { applied: false } } : blocked
	}

	const sandbox = { ...agentRun.sandbox, appliedRequirements: [...agentRun.sandbox.appliedRequirements, requirement], released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox })
	return updated.ok ? { ok: true, value: { applied: true, agentRun: { ...agentRun, sandbox } } } : updated
}

interface PreparedSandboxCommand {
	label: string
	command: { executable: string; args: string[]; cwd: string | null }
	commandSecretEnv: Record<string, string>
}

type CommandPreparationFailure = { summary: string }

function isCommandPreparationFailure(
	error: CommandPreparationFailure | Exclude<Error, InvalidInputError>,
): error is CommandPreparationFailure {
	return 'summary' in error
}

async function commandForRuntimeRequirement(
	runtime: CoreRuntime,
	requirement: AgentRunRuntimeRequirement,
): Promise<CoreResult<PreparedSandboxCommand, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	switch (requirement.type) {
		case 'environment-secret': {
			const plaintext = await resolveSecretPlaintext(runtime, requirement.secretId)
			return plaintext.ok
				? {
						ok: true,
						value: {
							label: `Set environment variable ${requirement.envName}`,
							command: { executable: 'gorchestra-env', args: ['set', requirement.envName], cwd: null },
							commandSecretEnv: { GORCHESTRA_SECRET_VALUE: plaintext.value },
						},
					}
				: plaintext
		}
		case 'run-command': {
			const commandSecretEnv = await resolveCommandSecretEnv(runtime, requirement.commandSecretEnv)
			return commandSecretEnv.ok
				? { ok: true, value: { label: requirement.label, command: requirement.command, commandSecretEnv: commandSecretEnv.value } }
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
	const resolvedEntries: Array<[string, string]> = []
	for (const [envName, secretId] of Object.entries(commandSecretEnv)) {
		const plaintext = await resolveSecretPlaintext(runtime, secretId)
		if (!plaintext.ok) return plaintext
		resolvedEntries.push([envName, plaintext.value])
	}
	return { ok: true, value: Object.fromEntries(resolvedEntries) }
}

async function resolveSecretPlaintext(
	runtime: CoreRuntime,
	secretId: Id,
): Promise<CoreResult<string, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const secret = await getRequired('secret', runtime.services.storage, secretId)
	if (!secret.ok) return secret
	if (isArchived(secret.value.archivePeriods)) return { ok: false, error: { summary: `Secret ${secretId} is archived.` } }

	let output: unknown
	try {
		output = await runtime.services.secrets.resolveSecretValues({ secrets: [{ secretId, valueRef: secret.value.valueRef }] })
	} catch {
		return { ok: false, error: { summary: `Secret ${secretId} could not be resolved.` } }
	}

	const values = validateCoreServiceOutput(resolvedSecretValuesPipe, output, 'secrets', 'resolveSecretValues')
	if (!values.ok) return values

	const plaintext = values.value[secretId]
	return plaintext === undefined
		? { ok: false, error: { summary: `Secret ${secretId} could not be resolved.` } }
		: { ok: true, value: plaintext }
}

async function runSandboxCommand(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	command: PreparedSandboxCommand,
): Promise<CoreResult<{ exitCode: number; summary: string }, Exclude<Error, InvalidInputError>>> {
	if (agentRun.sandbox.created === null) throw new Error('Sandbox should be created before command execution.')

	const sandboxRuntime = await resolveSandboxRuntimeForPreparation(runtime, agentRun)
	if (!sandboxRuntime.ok) {
		if (isCommandPreparationFailure(sandboxRuntime.error)) {
			return { ok: true, value: { exitCode: 1, summary: sandboxRuntime.error.summary } }
		}
		return { ok: false, error: sandboxRuntime.error }
	}

	let sandboxOutput: unknown
	try {
		sandboxOutput = await sandboxRuntime.value.find({ key: agentRun.sandbox.key })
	} catch {
		return { ok: true, value: { exitCode: 1, summary: 'Agent Run sandbox was not found.' } }
	}
	if (sandboxOutput === null) return { ok: true, value: { exitCode: 1, summary: 'Agent Run sandbox was not found.' } }

	const sandbox = validateCoreServiceOutput(sandboxPipe, sandboxOutput, 'sandbox', 'find')
	if (!sandbox.ok) return sandbox

	let output: unknown
	try {
		output = await sandbox.value.runCommand({
			label: command.label,
			command: command.command,
			commandSecretEnv: command.commandSecretEnv,
			timeoutMs: defaultSandboxCommandTimeoutMs,
		})
	} catch {
		return { ok: true, value: { exitCode: 1, summary: 'Sandbox command execution failed.' } }
	}

	const commandOutput = validateCoreServiceOutput(sandboxCommandOutputPipe, output, 'sandbox', 'runCommand')
	return commandOutput.ok ? { ok: true, value: commandOutput.value } : commandOutput
}

async function resolveSandboxRuntimeForPreparation(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<SandboxRuntime, CommandPreparationFailure | Exclude<Error, InvalidInputError>>> {
	const sandboxRuntime = await sandboxRuntimeForConfig(runtime, runtime.services.storage, agentRun.profile.sandboxConfig)
	return sandboxRuntime.ok ? sandboxRuntime : mapSandboxRuntimeResolutionError(sandboxRuntime.error)
}

function mapSandboxRuntimeResolutionError(
	error: SandboxRuntimeResolutionError,
): CoreResult<never, CommandPreparationFailure | Exclude<Error, InvalidInputError>> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return { ok: false, error: { summary: 'Vercel sandbox credential Secret is missing.' } }
	}
	if (error.type === 'secret-not-active') return { ok: false, error: { summary: 'Vercel sandbox credential Secret is not active.' } }
	if (error.type === 'sandbox-runtime-resolution-failed') return { ok: false, error: { summary: error.summary } }

	return { ok: false, error }
}

async function completePreparation(
	runtime: CoreRuntime,
	agentRun: AgentRun,
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
	return event.ok ? { ok: true, value: { ...agentRun, blocked: null, sandbox } } : event
}

async function blockPreparationFailure(
	runtime: CoreRuntime,
	agentRun: AgentRun,
	target: NonNullable<AgentRun['blocked']> extends infer Blocked
		? Blocked extends { type: 'sandbox-preparation-failed'; target: infer Target }
			? Target
			: never
		: never,
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

		it('creates a sandbox by key and applies environment Secret requirements', async () => {
			const commands: Array<{
				command: { executable: string; args: string[]; cwd: string | null }
				commandSecretEnv: Record<string, string>
			}> = []
			const sandboxes = new Map<
				string,
				{
					key: string
					runCommand: (input: {
						command: { executable: string; args: string[]; cwd: string | null }
						commandSecretEnv: Record<string, string>
					}) => Promise<unknown>
					release: () => Promise<unknown>
				}
			>()
			const options = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: () => Promise.resolve({ '01k00000000000000000000040': 'plaintext-token' }),
				},
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) => {
						const sandbox = {
							key,
							runCommand: (input: {
								command: { executable: string; args: string[]; cwd: string | null }
								commandSecretEnv: Record<string, string>
							}) => {
								commands.push({ command: input.command, commandSecretEnv: input.commandSecretEnv })
								return Promise.resolve({ exitCode: 0, summary: 'ok', stdout: null, stderr: null })
							},
							release: () => Promise.resolve({ summary: 'released' }),
						}
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
			expect(commands).toEqual([
				{
					command: { executable: 'gorchestra-env', args: ['set', 'NPM_TOKEN'], cwd: null },
					commandSecretEnv: { GORCHESTRA_SECRET_VALUE: 'plaintext-token' },
				},
			])
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
	})
}
