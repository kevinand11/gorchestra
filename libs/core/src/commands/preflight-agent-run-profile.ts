import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import { idPipe } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	SandboxOperationFailedError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import { managedSandboxProviderForConfig, type SandboxProviderResolutionError } from '../runtime/sandboxes'
import type { ManagedSandbox, ManagedSandboxProvider } from '../runtime/sandboxes/managed'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, isArchived, nextId, withTransaction } from './utils/storage'

const preflightAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof preflightAgentRunProfileInputPipe>

export type Result = ValidationEvidence
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type ProfilePreflightReadiness = { type: 'passed'; profile: AgentRunProfile } | { type: 'failed'; summary: string }

const preflightEnv = { name: 'GORCHESTRA_PREFLIGHT', value: 'ok' } as const
const preflightCommand = {
	executable: 'sh',
	args: ['-lc', 'test "$GORCHESTRA_PREFLIGHT" = "ok"'],
	cwd: '/workspace',
} as const

export function createPreflightAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('preflightAgentRunProfile', preflightAgentRunProfileInputPipe, async (input) => {
		const readiness = await readProfilePreflightReadiness(runtime.services, input.agentRunProfileId)
		if (!readiness.ok) return readiness
		if (readiness.value.type === 'failed') return { ok: true, value: profilePreflightEvidence(false, readiness.value.summary) }

		const sandboxProvider = await managedSandboxProviderForConfig(
			runtime,
			runtime.services.storage,
			readiness.value.profile.sandboxConfig,
		)
		if (!sandboxProvider.ok) return sandboxProviderResolutionResult(sandboxProvider.error)

		const preflightId = nextId(runtime.values)
		if (!preflightId.ok) return preflightId

		return runSandboxSmokePreflight(
			sandboxProvider.value,
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
	sandboxProvider: ManagedSandboxProvider,
	profile: AgentRunProfile,
	key: string,
): Promise<CoreResult<ValidationEvidence, InvalidCoreServiceOutputError>> {
	const created = await sandboxProvider.create({ key, config: profile.sandboxConfig })
	if (!created.ok) return sandboxOperationPreflightResult(created.error)

	const result = await verifySandboxRuntimeEnv(created.value)
	const release = await created.value.release()
	return release.ok ? result : sandboxOperationPreflightResult(release.error)
}

async function verifySandboxRuntimeEnv(sandbox: ManagedSandbox): Promise<CoreResult<ValidationEvidence, InvalidCoreServiceOutputError>> {
	const env = await sandbox.setEnv(preflightEnv)
	if (!env.ok) return sandboxOperationPreflightResult(env.error)
	if (env.value.exitCode !== 0) return { ok: true, value: profilePreflightEvidence(false, env.value.summary) }

	const output = await sandbox.runCommand({
		label: 'Agent Run Profile sandbox runtime environment check',
		command: { executable: preflightCommand.executable, args: [...preflightCommand.args], cwd: preflightCommand.cwd },
		commandSecretEnv: {},
		timeoutMs: 30_000,
	})
	if (!output.ok) return sandboxOperationPreflightResult(output.error)
	return output.value.exitCode === 0
		? { ok: true, value: profilePreflightEvidence(true, 'Agent Run Profile sandbox preflight passed.') }
		: { ok: true, value: profilePreflightEvidence(false, output.value.summary) }
}

function sandboxOperationPreflightResult(
	error: InvalidCoreServiceOutputError | SandboxOperationFailedError,
): CoreResult<ValidationEvidence, InvalidCoreServiceOutputError> {
	return error.type === 'sandbox-operation-failed'
		? { ok: true, value: profilePreflightEvidence(false, error.summary) }
		: { ok: false, error }
}

function sandboxProviderResolutionResult(error: SandboxProviderResolutionError): CoreResult<ValidationEvidence, Error> {
	return error.type === 'sandbox-provider-resolution-failed'
		? { ok: true, value: profilePreflightEvidence(false, error.summary) }
		: { ok: false, error }
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

		it('creates a temporary sandbox, verifies managed runtime env, and releases it', async () => {
			const runCommands: unknown[] = []
			const releases: string[] = []
			const files = new Map<string, string>()
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve({
							runCommand: (input) => {
								runCommands.push(input)
								return Promise.resolve({ exitCode: 0, summary: 'Raw command succeeded.', stdout: null, stderr: null })
							},
							readFile: (path) => Promise.resolve(files.get(path) ?? null),
							writeFile: (path, contents) => {
								files.set(path, contents)
								return Promise.resolve()
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
					command: { executable: 'sh', args: ['-lc', 'test "$GORCHESTRA_PREFLIGHT" = "ok"'], cwd: '/workspace' },
					env: { GORCHESTRA_PREFLIGHT: 'ok' },
					timeoutMs: 30_000,
				},
			])
			expect(files.get('/workspace/.gorchestra/runtime-env.json')).toBe('{}\n')
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

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox token Secret is missing.') })
		})

		it('returns failed evidence when the smoke command exits non-zero and still releases the sandbox', async () => {
			let released = false
			const files = new Map<string, string>()
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: () =>
						Promise.resolve({
							runCommand: () =>
								Promise.resolve({ exitCode: 1, summary: 'Smoke command failed.', stdout: null, stderr: 'bad' }),
							readFile: (path) => Promise.resolve(files.get(path) ?? null),
							writeFile: (path, contents) => {
								files.set(path, contents)
								return Promise.resolve()
							},
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

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Command exited with status 1.') })
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

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Vercel sandbox token Secret is not active.') })
		})
	})
}
