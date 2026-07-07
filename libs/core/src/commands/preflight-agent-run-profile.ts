import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { sandboxRuntimeForConfig, sandboxSmokeCommand, type SandboxRuntimeResolutionError } from '../runtime/agent-runs/sandbox-runtime'
import { sandboxCommandOutputPipe, sandboxReleaseOutputPipe, type CoreStorage, type Sandbox, type SandboxRuntime } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { validateCoreServiceOutput } from '../validation'
import { buildCommandHandler } from './utils/handler'
import { getRequired, isArchived, nextId, withTransaction } from './utils/storage'

const preflightAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof preflightAgentRunProfileInputPipe>

export type Result = ValidationEvidence
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type ProfilePreflightReadiness = { type: 'passed'; profile: AgentRunProfile } | { type: 'failed'; summary: string }

export function createPreflightAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('preflightAgentRunProfile', preflightAgentRunProfileInputPipe, async (input) => {
		const readiness = await readProfilePreflightReadiness(runtime.services, input.agentRunProfileId)
		if (!readiness.ok) return readiness
		if (readiness.value.type === 'failed') return { ok: true, value: profilePreflightEvidence(false, readiness.value.summary) }

		const sandboxRuntime = await sandboxRuntimeForConfig(runtime, runtime.services.storage, readiness.value.profile.sandboxConfig)
		if (!sandboxRuntime.ok) return sandboxRuntimeResolutionResult(sandboxRuntime.error)

		const preflightId = nextId(runtime.values)
		if (!preflightId.ok) return preflightId

		return runSandboxSmokePreflight(
			sandboxRuntime.value,
			readiness.value.profile,
			`preflight-${readiness.value.profile.id}-${preflightId.value}`,
		)
	})
}

function readProfilePreflightReadiness(
	options: CoreRuntime['services'],
	agentRunProfileId: string,
): Promise<CoreResult<ProfilePreflightReadiness, InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError>> {
	return withTransaction(options, (storage) => readProfilePreflightReadinessFromStorage(storage, agentRunProfileId))
}

async function readProfilePreflightReadinessFromStorage(
	storage: CoreStorage,
	agentRunProfileId: string,
): Promise<CoreResult<ProfilePreflightReadiness, InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError>> {
	const profile = await getRequired('agent-run-profile', storage, agentRunProfileId)
	if (!profile.ok) return profile

	return isArchived(profile.value.archivePeriods)
		? { ok: true, value: { type: 'failed', summary: 'Agent Run Profile is archived.' } }
		: { ok: true, value: { type: 'passed', profile: profile.value } }
}

async function runSandboxSmokePreflight(
	sandboxRuntime: SandboxRuntime,
	profile: AgentRunProfile,
	key: string,
): Promise<CoreResult<ValidationEvidence, InvalidCoreServiceOutputError>> {
	let sandbox: Sandbox | null = null
	let result: CoreResult<ValidationEvidence, InvalidCoreServiceOutputError> = {
		ok: true,
		value: profilePreflightEvidence(false, 'Agent Run Profile sandbox preflight failed.'),
	}

	try {
		sandbox = await sandboxRuntime.create({ key, config: profile.sandboxConfig })
		const output = await sandbox.runCommand({
			label: 'Agent Run Profile sandbox smoke check',
			command: { executable: sandboxSmokeCommand.executable, args: [...sandboxSmokeCommand.args], cwd: sandboxSmokeCommand.cwd },
			commandSecretEnv: {},
			timeoutMs: 30_000,
		})
		const validated = validateCoreServiceOutput(sandboxCommandOutputPipe, output, 'sandbox', 'runCommand')
		result = validated.ok
			? validated.value.exitCode === 0
				? { ok: true, value: profilePreflightEvidence(true, 'Agent Run Profile sandbox preflight passed.') }
				: { ok: true, value: profilePreflightEvidence(false, validated.value.summary) }
			: validated
	} catch {
		result = { ok: true, value: profilePreflightEvidence(false, 'Agent Run Profile sandbox preflight failed.') }
	}

	if (sandbox !== null) {
		try {
			const release = await sandbox.release()
			const validatedRelease = validateCoreServiceOutput(sandboxReleaseOutputPipe, release, 'sandbox', 'release')
			if (!validatedRelease.ok) return validatedRelease
		} catch {
			return { ok: true, value: profilePreflightEvidence(false, 'Agent Run Profile sandbox release failed.') }
		}
	}

	return result
}

function sandboxRuntimeResolutionResult(error: SandboxRuntimeResolutionError): CoreResult<ValidationEvidence, Error> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return { ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox credential Secret is missing.') }
	}
	if (error.type === 'secret-not-active') {
		return { ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox credential Secret is not active.') }
	}
	if (error.type === 'sandbox-runtime-resolution-failed') {
		return { ok: true, value: profilePreflightEvidence(false, error.summary) }
	}

	return { ok: false, error }
}

function profilePreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: 'agent-run-profile-preflight' }, passed, summary }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, defaultAgentRunSandboxConfig, seedAgentRunProfile, seedSecret } =
		await import('../utils/test-helpers')

	describe('preflightAgentRunProfile command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRunProfiles.fail.get = true
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'preflightAgentRunProfile' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns failed evidence for archived Agent Run Profiles', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', { archived: true })
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Agent Run Profile is archived.') })
		})

		it('creates a temporary sandbox, runs the smoke command, and releases it', async () => {
			const runCommands: unknown[] = []
			const releases: string[] = []
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve({
							key,
							runCommand: (input) => {
								runCommands.push(input)
								return Promise.resolve({ exitCode: 0, summary: 'Command succeeded.', stdout: null, stderr: null })
							},
							release: () => {
								releases.push(key)
								return Promise.resolve({ summary: 'Sandbox released.' })
							},
						}),
					find: () => Promise.resolve(null),
				},
			})
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(true, 'Agent Run Profile sandbox preflight passed.') })
			expect(runCommands).toEqual([
				{
					label: 'Agent Run Profile sandbox smoke check',
					command: { executable: 'true', args: [], cwd: '/workspace' },
					commandSecretEnv: {},
					timeoutMs: 30_000,
				},
			])
			expect(releases).toEqual(['preflight-01k00000000000000000000006-01k00000000000000000010001'])
		})

		it('returns failed evidence when Vercel credential Secrets are missing', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.sandboxConfig = {
				source: {
					type: 'vercel-runtime',
					runtime: 'node24',
					credentials: {
						tokenSecretId: '01k00000000000000000000040',
						teamIdSecretId: '01k00000000000000000000041',
						projectIdSecretId: '01k00000000000000000000042',
					},
				},
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			}
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox credential Secret is missing.') })
		})

		it('returns failed evidence when the smoke command exits non-zero and still releases the sandbox', async () => {
			let released = false
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve({
							key,
							runCommand: () =>
								Promise.resolve({ exitCode: 1, summary: 'Smoke command failed.', stdout: null, stderr: 'bad' }),
							release: () => {
								released = true
								return Promise.resolve({ summary: 'Sandbox released.' })
							},
						}),
					find: () => Promise.resolve(null),
				},
			})
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', {
				runtimeRequirements: [],
			})
			options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.sandboxConfig = defaultAgentRunSandboxConfig()
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Smoke command failed.') })
			expect(released).toBe(true)
		})

		it('returns failed evidence for inactive Vercel credential Secrets', async () => {
			const options = createTestCoreServices()
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			seedSecret(options.tx, '01k00000000000000000000040', true)
			options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.sandboxConfig = {
				source: {
					type: 'vercel-vcr-image',
					vcrImage: 'runtime-image:latest',
					credentials: {
						tokenSecretId: '01k00000000000000000000040',
						teamIdSecretId: '01k00000000000000000000040',
						projectIdSecretId: '01k00000000000000000000040',
					},
				},
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			}
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox credential Secret is not active.') })
		})
	})
}
