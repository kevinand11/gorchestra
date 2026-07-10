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
import type { RawSandboxRunCommandInput, SandboxCommandOutput } from '../services'
import { globalRuntimeRequirements, type AgentRunRunCommandRuntimeRequirement } from '../utils/agent-run-runtime-requirements'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, isArchived, nextId, withTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import { managedSandboxProviderForConfig, type SandboxProviderResolutionError } from '../utils/runtime/sandboxes'
import {
	managedSandboxFileApiReadinessDirectory,
	verifyManagedSandboxFileApiReadiness,
	type ManagedSandbox,
	type ManagedSandboxFileApiReadinessError,
	type ManagedSandboxProvider,
} from '../utils/runtime/sandboxes/managed'
import type { Result as CoreResult } from '../utils/types'

const preflightAgentRunProfileInputPipe = v.object({ agentRunProfileId: idPipe })
export type Input = PipeOutput<typeof preflightAgentRunProfileInputPipe>

export type Result = ValidationEvidence
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type ProfilePreflightReadiness = { type: 'passed'; profile: AgentRunProfile } | { type: 'failed'; summary: string }

const preflightEnv = { name: 'GORCHESTRA_PREFLIGHT', value: 'ok' } as const
const preflightRuntimeEnvCommand: AgentRunRunCommandRuntimeRequirement = {
	type: 'run-command',
	label: 'Agent Run Profile sandbox runtime environment check',
	command: { executable: 'sh', args: ['-c', 'test "$GORCHESTRA_PREFLIGHT" = "ok"'], cwd: '/workspace' },
	root: true,
	commandSecretEnv: {},
}

export function createPreflightAgentRunProfileCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('preflightAgentRunProfile', preflightAgentRunProfileInputPipe, async (input) => {
		const readiness = await withTransaction<
			ProfilePreflightReadiness,
			InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
		>(runtime.services, async (storage) => {
			const profile = await getRequired('agent-run-profile', storage, input.agentRunProfileId)
			if (!profile.ok) return profile

			return isArchived(profile.value.archivePeriods)
				? { ok: true, value: { type: 'failed', summary: 'Agent Run Profile is archived.' } }
				: { ok: true, value: { type: 'passed', profile: profile.value } }
		})
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

async function runSandboxSmokePreflight(
	sandboxProvider: ManagedSandboxProvider,
	profile: AgentRunProfile,
	key: string,
): Promise<CoreResult<ValidationEvidence, InvalidCoreServiceOutputError>> {
	const created = await sandboxProvider.create({ key, config: profile.sandboxConfig })
	if (!created.ok) return sandboxOperationPreflightResult(created.error)

	const result = await verifySandboxRuntimeEnv(created.value, key)
	const release = await created.value.release()
	return release.ok ? result : sandboxOperationPreflightResult(release.error)
}

async function verifySandboxRuntimeEnv(
	sandbox: ManagedSandbox,
	key: string,
): Promise<CoreResult<ValidationEvidence, InvalidCoreServiceOutputError>> {
	for (const requirement of globalRuntimeRequirements) {
		const output = await sandbox.runCommand({
			...requirement,
			timeoutMs: 600_000,
		})
		if (!output.ok) return sandboxOperationPreflightResult(output.error)
		if (output.value.exitCode !== 0) return { ok: true, value: profilePreflightEvidence(false, output.value.summary) }
	}

	const fileApi = await verifyManagedSandboxFileApiReadiness({
		sandbox,
		directoryPath: managedSandboxFileApiReadinessDirectory(key),
	})
	if (!fileApi.ok) return sandboxFileApiReadinessPreflightResult(fileApi.error)

	const env = await sandbox.setEnv(preflightEnv)
	if (!env.ok) return sandboxOperationPreflightResult(env.error)
	if (env.value.exitCode !== 0) return { ok: true, value: profilePreflightEvidence(false, env.value.summary) }

	const output = await sandbox.runCommand({
		...preflightRuntimeEnvCommand,
		timeoutMs: 30_000,
	})
	if (!output.ok) return sandboxOperationPreflightResult(output.error)
	return output.value.exitCode === 0
		? { ok: true, value: profilePreflightEvidence(true, 'Agent Run Profile sandbox preflight passed.') }
		: { ok: true, value: profilePreflightEvidence(false, output.value.summary) }
}

function sandboxFileApiReadinessPreflightResult(
	error: ManagedSandboxFileApiReadinessError,
): CoreResult<ValidationEvidence, InvalidCoreServiceOutputError> {
	return error.type === 'sandbox-file-api-readiness-failed'
		? { ok: true, value: profilePreflightEvidence(false, error.summary) }
		: sandboxOperationPreflightResult(error)
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
	const {
		context,
		createTestCoreRuntime,
		createTestCoreServices,
		defaultAgentRunSandboxConfig,
		deleteTestSandboxPath,
		listTestSandboxDirectory,
		readTestSandboxFile,
		seedAgentRunProfile,
		seedSecret,
		writeTestSandboxFile,
	} = await import('../utils/test-helpers')

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

		it('creates a temporary sandbox, verifies managed file APIs and runtime env, and releases it', async () => {
			const runCommands: unknown[] = []
			const fileOperations: string[] = []
			const releases: string[] = []
			const files = new Map<string, string>()
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve(
							preflightRawSandbox({ key, files, runCommands, fileOperations, release: () => releases.push(key) }),
						),
					find: () => Promise.resolve(null),
				},
			})
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(true, 'Agent Run Profile sandbox preflight passed.') })
			expect(runCommands).toHaveLength(4)
			expect(runCommands[0]).toEqual({
				command: {
					executable: 'sh',
					args: ['-c', 'mkdir -p /workspace/.gorchestra && chmod 700 /workspace/.gorchestra'],
					cwd: '/workspace',
				},
				env: {},
				root: true,
				timeoutMs: 30_000,
			})
			expect(runCommands[1]).toEqual({
				command: { executable: 'sh', args: ['-c', 'command -v sh >/dev/null'], cwd: '/workspace' },
				env: {},
				root: true,
				timeoutMs: 600_000,
			})
			expect(runCommands[2]).toMatchObject({
				command: { executable: 'sh', cwd: '/workspace' },
				env: {},
				root: true,
				timeoutMs: 600_000,
			})
			expect((runCommands[2] as { command: { args: string[] } }).command.args[1]).toContain('command -v rg >/dev/null')
			expect((runCommands[2] as { command: { args: string[] } }).command.args[1]).toContain('command -v fd >/dev/null')
			expect(runCommands[3]).toEqual({
				command: { executable: 'sh', args: ['-c', 'test "$GORCHESTRA_PREFLIGHT" = "ok"'], cwd: '/workspace' },
				env: { GORCHESTRA_PREFLIGHT: 'ok' },
				root: true,
				timeoutMs: 30_000,
			})
			const checkDirectory = managedSandboxFileApiReadinessDirectory(
				'preflight-01k00000000000000000000006-01k00000000000000000010001',
			)
			expect(fileOperations.filter((operation) => operation.includes(checkDirectory))).toEqual([
				`write:${checkDirectory}/check.txt`,
				`read:${checkDirectory}/check.txt`,
				`list:${checkDirectory}`,
				`delete:${checkDirectory}`,
				`read:${checkDirectory}/check.txt`,
			])
			expect(fileOperations.indexOf(`delete:${checkDirectory}`)).toBeLessThan(
				fileOperations.findIndex((operation) => operation === 'write:/workspace/.gorchestra/runtime-env.json'),
			)
			expect(files.get('/workspace/.gorchestra/runtime-env.json')).toBe('{}\n')
			expect(releases).toEqual(['preflight-01k00000000000000000000006-01k00000000000000000010001'])
		})

		it('returns failed evidence when managed file API readiness fails and still releases the sandbox', async () => {
			const runCommands: unknown[] = []
			const files = new Map<string, string>()
			let released = false
			const options = createTestCoreServices({
				sandbox: {
					kind: 'consumer-managed',
					create: ({ key }) =>
						Promise.resolve(
							preflightRawSandbox({
								key,
								files,
								runCommands,
								failWritePath: (path) => path.startsWith(managedSandboxFileApiReadinessDirectory(key)),
								release: () => {
									released = true
								},
							}),
						),
					find: () => Promise.resolve(null),
				},
			})
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			const command = createPreflightAgentRunProfileCommand(createTestCoreRuntime(options))

			const result = await command({ agentRunProfileId: '01k00000000000000000000006' }, context)

			expect(result).toEqual({ ok: true, value: profilePreflightEvidence(false, 'Sandbox file write failed.') })
			expect(runCommands).toHaveLength(3)
			expect(runCommands[1]).toMatchObject({ timeoutMs: 600_000 })
			expect(runCommands[2]).toMatchObject({ timeoutMs: 600_000 })
			expect(released).toBe(true)
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
					create: ({ key }) =>
						Promise.resolve(
							preflightRawSandbox({
								key,
								files,
								commandOutput: (_input, count) =>
									count < 4
										? { exitCode: 0, summary: 'Raw command succeeded.', stdout: null, stderr: null }
										: { exitCode: 1, summary: 'Smoke command failed.', stdout: null, stderr: 'bad' },
								release: () => {
									released = true
								},
							}),
						),
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

	function preflightRawSandbox(input: {
		key: string
		files: Map<string, string>
		runCommands?: unknown[]
		fileOperations?: string[]
		failWritePath?: (path: string) => boolean
		commandOutput?: (command: RawSandboxRunCommandInput, count: number) => SandboxCommandOutput
		release?: () => void
	}) {
		let commandCount = 0
		return {
			runCommand: (command: RawSandboxRunCommandInput) => {
				commandCount += 1
				input.runCommands?.push(command)
				return Promise.resolve(input.commandOutput?.(command, commandCount) ?? successfulCommandOutput())
			},
			readFile: (path: string) => {
				input.fileOperations?.push(`read:${path}`)
				return Promise.resolve(readTestSandboxFile(input.files, path))
			},
			writeFile: (path: string, contentsBase64: string) => {
				input.fileOperations?.push(`write:${path}`)
				if (input.failWritePath?.(path)) return Promise.reject(new Error('write failed'))
				writeTestSandboxFile(input.files, path, contentsBase64)
				return Promise.resolve()
			},
			listDirectory: (path: string) => {
				input.fileOperations?.push(`list:${path}`)
				return Promise.resolve(listTestSandboxDirectory(input.files, path))
			},
			deletePath: (path: string) => {
				input.fileOperations?.push(`delete:${path}`)
				deleteTestSandboxPath(input.files, path)
				return Promise.resolve()
			},
			release: () => {
				input.release?.()
				return Promise.resolve({ summary: 'Sandbox released.' })
			},
		}
	}

	function successfulCommandOutput(): SandboxCommandOutput {
		return { exitCode: 0, summary: 'Raw command succeeded.', stdout: null, stderr: null }
	}
}
