import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { isArchived } from '../commands/utils/storage'
import type { AgentRun, AgentRunEventCursor } from '../domain/agent-run'
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
import { resolvedSecretValuesPipe, sandboxAssignmentOutputPipe, sandboxCommandOutputPipe, type CoreServices } from '../services'
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

	const assigned = await ensureSandboxAssignment(runtime, loaded.value)
	if (!assigned.ok) return assigned
	if (assigned.value.completed !== null) return { ok: true, value: undefined }

	if (isPrepared(assigned.value)) return { ok: true, value: undefined }

	const started = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, {
		type: 'agent-run-sandbox-preparation-started',
		requestedThroughCursor: latestRuntimeOverrideCursor(assigned.value),
	})
	if (!started.ok) return started

	return applyRuntimeRequirements(runtime, assigned.value)
}

async function ensureSandboxAssignment(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	if (agentRun.sandbox.assignment !== null) return { ok: true, value: agentRun }

	let output: unknown
	try {
		output = await runtime.services.sandbox.assign({ agentRunId: agentRun.id })
	} catch {
		return blockPreparationFailure(runtime, agentRun, { type: 'source-checkout' }, 'Sandbox assignment failed.')
	}

	const assignment = validateCoreServiceOutput(sandboxAssignmentOutputPipe, output, 'sandbox', 'assign')
	if (!assignment.ok) return assignment

	const assigned = runtimeRecord(runtime.values)
	if (!assigned.ok) return assigned

	const sandbox = { ...agentRun.sandbox, assignment: { ref: assignment.value.ref, assigned: assigned.value }, released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-assigned',
		assignment: { ref: assignment.value.ref },
	})
	return event.ok ? { ok: true, value: { ...agentRun, sandbox } } : event
}

function isPrepared(agentRun: AgentRun): boolean {
	return (
		agentRun.blocked === null &&
		agentRun.sandbox.assignment !== null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughCursor === latestRuntimeOverrideCursor(agentRun)
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

	const execution = await runSandboxCommand(runtime.services, agentRun, command.value)
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
	services: CoreServices,
	agentRun: AgentRun,
	command: PreparedSandboxCommand,
): Promise<CoreResult<{ exitCode: number; summary: string }, InvalidCoreServiceOutputError>> {
	if (agentRun.sandbox.assignment === null) throw new Error('Sandbox assignment should exist before command execution.')
	let output: unknown
	try {
		output = await services.sandbox.runCommand({
			ref: agentRun.sandbox.assignment.ref,
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

async function completePreparation(
	runtime: CoreRuntime,
	agentRun: AgentRun,
): Promise<CoreResult<AgentRun, Exclude<Error, InvalidInputError>>> {
	const appliedThroughCursor = latestRuntimeOverrideCursor(agentRun)
	const sandbox = { ...agentRun.sandbox, appliedThroughCursor, released: null }
	const updated = await updateRecord('agent-run', runtime.services.storage, agentRun.id, { blocked: null, sandbox })
	if (!updated.ok) return updated

	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRun.id, {
		type: 'agent-run-sandbox-preparation-completed',
		appliedThroughCursor,
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

function latestRuntimeOverrideCursor(agentRun: AgentRun): AgentRunEventCursor | null {
	return agentRun.runtimeRequirementOverrides.at(-1)?.eventCursor ?? null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedSecret, testModelAgentRun } = await import('../utils/test-helpers')

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

		it('assigns a sandbox and applies environment Secret requirements', async () => {
			const commands: Array<{
				command: { executable: string; args: string[]; cwd: string | null }
				commandSecretEnv: Record<string, string>
			}> = []
			const options = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: () => Promise.resolve({ 'secret-1': 'plaintext-token' }),
				},
				sandbox: {
					preflight: () => Promise.resolve({ ok: true }),
					assign: () => Promise.resolve({ ref: 'sandbox-ref' }),
					runCommand: (input) => {
						commands.push({ command: input.command, commandSecretEnv: input.commandSecretEnv })
						return Promise.resolve({ exitCode: 0, summary: 'ok', stdout: null, stderr: null })
					},
					release: () => Promise.resolve({ summary: 'released' }),
				},
			})
			seedSecret(options.tx, 'secret-1')
			options.tx.agentRuns.records.set(
				'agent-run-1',
				testModelAgentRun({
					profile: {
						agentRunProfileId: 'agent-run-profile-1',
						name: 'Agent Run Profile',
						modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
						runtimeRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' }],
					},
				}),
			)
			options.tx.agentRuns.records.get('agent-run-1')!.desiredRuntimeRequirements = [
				{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' },
			]

			const operation = createPrepareAgentRunSandboxOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: 'agent-run-1' }, { correlationId: null })

			expect(result).toEqual({ ok: true, value: undefined })
			expect(commands).toEqual([
				{
					command: { executable: 'gorchestra-env', args: ['set', 'NPM_TOKEN'], cwd: null },
					commandSecretEnv: { GORCHESTRA_SECRET_VALUE: 'plaintext-token' },
				},
			])
			expect(options.tx.agentRuns.records.get('agent-run-1')).toMatchObject({
				blocked: null,
				sandbox: {
					assignment: { ref: 'sandbox-ref' },
					appliedRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: 'secret-1' }],
					appliedThroughCursor: null,
					released: null,
				},
			})
		})
	})
}
