import { v } from 'valleyed'

import type { AgentRunSandboxSourceConfig } from '../../domain/agent-run-runtime'
import { envNamePipe } from '../../domain/secret'
import type { InvalidCoreServiceOutputError, SandboxOperationFailedError } from '../../errors'
import {
	rawSandboxPipe,
	sandboxCommandOutputPipe,
	sandboxReleaseOutputPipe,
	type AgentRunSandboxConfigForSource,
	type CoreLogger,
	type RawSandbox,
	type RawSandboxProvider,
	type RawSandboxRunCommandInput,
	type SandboxCommandOutput,
	type SandboxReleaseOutput,
} from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

const runtimeEnvStorePath = '/workspace/.gorchestra/runtime-env.json'
const commandOutputLimitBytes = 16 * 1024
const runtimeEnvFilePipe = v.fromJson(v.record(envNamePipe, v.string()))
const readFileOutputPipe = v.nullable(v.string())

export type ManagedSandboxError = InvalidCoreServiceOutputError | SandboxOperationFailedError

export interface ManagedSandboxRunCommandInput {
	label: string
	command: { executable: string; args: string[]; cwd: string | null }
	commandSecretEnv: Record<string, string>
	root: boolean
	timeoutMs: number
}

export interface ManagedSandbox {
	setEnv(input: { name: string; value: string }): Promise<Result<SandboxCommandOutput, ManagedSandboxError>>
	runCommand(input: ManagedSandboxRunCommandInput): Promise<Result<SandboxCommandOutput, ManagedSandboxError>>
	release(): Promise<Result<SandboxReleaseOutput, ManagedSandboxError>>
}

export interface ManagedSandboxProvider<SourceConfig extends AgentRunSandboxSourceConfig = AgentRunSandboxSourceConfig> {
	kind: SourceConfig['type']
	create(input: {
		key: string
		config: AgentRunSandboxConfigForSource<SourceConfig>
	}): Promise<Result<ManagedSandbox, ManagedSandboxError>>
	find(input: { key: string }): Promise<Result<ManagedSandbox | null, ManagedSandboxError>>
}

export function manageSandboxProvider<SourceConfig extends AgentRunSandboxSourceConfig>(
	provider: RawSandboxProvider<SourceConfig>,
	options: { logger?: CoreLogger } = {},
): ManagedSandboxProvider<SourceConfig> {
	return {
		kind: provider.kind,
		create: async (input) => {
			try {
				const raw = await provider.create(input)
				const validated = validateCoreServiceOutput(rawSandboxPipe, raw, 'sandbox', 'create')
				return validated.ok ? { ok: true, value: manageSandbox(validated.value, input.key, options) } : validated
			} catch {
				return sandboxOperationFailed('create', 'Sandbox creation failed.')
			}
		},
		find: async (input) => {
			try {
				const raw = await provider.find(input)
				if (raw === null) return { ok: true, value: null }
				const validated = validateCoreServiceOutput(rawSandboxPipe, raw, 'sandbox', 'find')
				return validated.ok ? { ok: true, value: manageSandbox(validated.value, input.key, options) } : validated
			} catch {
				return sandboxOperationFailed('find', 'Sandbox lookup failed.')
			}
		},
	}
}

function manageSandbox(raw: RawSandbox, key: string, options: { logger?: CoreLogger }): ManagedSandbox {
	return {
		setEnv: async ({ name, value }) => {
			const runtimeEnv = await readRuntimeEnv(raw, 'set-env')
			if (!runtimeEnv.ok) return runtimeEnv

			try {
				await raw.writeFile(runtimeEnvStorePath, `${JSON.stringify({ ...runtimeEnv.value, [name]: value })}\n`)
				return { ok: true, value: { exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null } }
			} catch {
				return sandboxOperationFailed('set-env', 'Sandbox runtime environment update failed.')
			}
		},
		runCommand: async (input) => {
			const runtimeEnv = await readRuntimeEnv(raw, 'run-command')
			if (!runtimeEnv.ok) return runtimeEnv

			const env = { ...runtimeEnv.value, ...input.commandSecretEnv }
			const redactedValues = [...Object.values(runtimeEnv.value), ...Object.values(input.commandSecretEnv)]
			let output: unknown
			try {
				output = await raw.runCommand({
					command: { ...input.command, cwd: input.command.cwd ?? '/workspace' },
					env,
					root: input.root,
					timeoutMs: input.timeoutMs,
				} satisfies RawSandboxRunCommandInput)
			} catch {
				return sandboxOperationFailed('run-command', 'Sandbox command execution failed.')
			}

			const validated = validateCoreServiceOutput(sandboxCommandOutputPipe, output, 'sandbox', 'runCommand')
			return validated.ok ? { ok: true, value: managedCommandOutput(validated.value, redactedValues) } : validated
		},
		release: async () => {
			let wipeFailed = false
			try {
				await raw.writeFile(runtimeEnvStorePath, '{}\n')
			} catch {
				wipeFailed = true
			}

			let output: unknown
			try {
				output = await raw.release()
			} catch {
				return sandboxOperationFailed(
					'release',
					wipeFailed ? 'Sandbox runtime environment wipe and release failed.' : 'Sandbox release failed.',
				)
			}

			const validated = validateCoreServiceOutput(sandboxReleaseOutputPipe, output, 'sandbox', 'release')
			if (!validated.ok) return validated
			if (wipeFailed) options.logger?.warn('Sandbox runtime environment wipe failed before release.', { sandboxKey: key })
			return { ok: true, value: validated.value }
		},
	}
}

async function readRuntimeEnv(
	raw: RawSandbox,
	operation: 'set-env' | 'run-command',
): Promise<Result<Record<string, string>, ManagedSandboxError>> {
	let contents: unknown
	try {
		contents = await raw.readFile(runtimeEnvStorePath)
	} catch {
		return sandboxOperationFailed(operation, 'Sandbox runtime environment read failed.')
	}

	const readOutput = validateCoreServiceOutput(readFileOutputPipe, contents, 'sandbox', 'readFile')
	if (!readOutput.ok) return readOutput
	if (readOutput.value === null) return { ok: true, value: {} }

	const parsed = v.validate(runtimeEnvFilePipe, readOutput.value)
	return parsed.valid
		? { ok: true, value: parsed.value }
		: sandboxOperationFailed(operation, 'Sandbox runtime environment store is invalid.')
}

function managedCommandOutput(output: SandboxCommandOutput, secrets: string[]): SandboxCommandOutput {
	return {
		exitCode: output.exitCode,
		summary: output.exitCode === 0 ? 'Command completed.' : `Command exited with status ${output.exitCode}.`,
		stdout: output.stdout === null ? null : normalizedStream(output.stdout, secrets),
		stderr: output.stderr === null ? null : normalizedStream(output.stderr, secrets),
	}
}

function normalizedStream(value: string, secrets: string[]): string | null {
	const redacted = secrets
		.filter((secret) => secret.length > 0)
		.reduce((current, secret) => current.split(secret).join('[REDACTED]'), value)
	const truncated = truncateUtf8(redacted, commandOutputLimitBytes)
	return truncated.length === 0 ? null : truncated
}

function truncateUtf8(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value)
	return bytes.byteLength <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8')
}

function sandboxOperationFailed<T>(
	operation: SandboxOperationFailedError['operation'],
	summary: string,
): Result<T, SandboxOperationFailedError> {
	return { ok: false, error: { type: 'sandbox-operation-failed', operation, summary } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('manageSandboxProvider', () => {
		it('sets runtime env, injects it into commands, overlays command env, redacts, truncates, and normalizes summaries', async () => {
			const fake = fakeRawSandboxProvider()
			const provider = manageSandboxProvider(fake.provider)
			const created = await provider.create({ key: 'agent-run-key', config: fakeConfig() })
			if (!created.ok) throw new Error('Expected sandbox creation to pass.')

			await expect(created.value.setEnv({ name: 'NPM_TOKEN', value: 'prepared-secret' })).resolves.toEqual({
				ok: true,
				value: { exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null },
			})

			fake.nextCommandOutput = {
				exitCode: 7,
				summary: 'provider summary',
				stdout: `prepared-secret command-secret ${'x'.repeat(20 * 1024)}`,
				stderr: 'prepared-secret',
			}

			const output = await created.value.runCommand({
				label: 'Echo',
				command: { executable: 'printenv', args: ['NPM_TOKEN'], cwd: null },
				commandSecretEnv: { NPM_TOKEN: 'command-secret' },
				root: false,
				timeoutMs: 30_000,
			})

			expect(fake.commands).toEqual([
				{
					command: { executable: 'printenv', args: ['NPM_TOKEN'], cwd: '/workspace' },
					env: { NPM_TOKEN: 'command-secret' },
					root: false,
					timeoutMs: 30_000,
				},
			])
			expect(output.ok && output.value.summary).toBe('Command exited with status 7.')
			expect(output.ok && output.value.stdout?.includes('prepared-secret')).toBe(false)
			expect(output.ok && output.value.stdout?.includes('command-secret')).toBe(false)
			expect(output.ok && Buffer.from(output.value.stdout ?? '').byteLength).toBeLessThanOrEqual(16 * 1024)
			expect(output.ok && output.value.stderr).toBe('[REDACTED]')
		})

		it('maps invalid runtime env file contents to a sandbox operation failure', async () => {
			const fake = fakeRawSandboxProvider({ files: new Map([[runtimeEnvStorePath, '{bad json']]) })
			const provider = manageSandboxProvider(fake.provider)
			const created = await provider.create({ key: 'agent-run-key', config: fakeConfig() })
			if (!created.ok) throw new Error('Expected sandbox creation to pass.')

			await expect(
				created.value.runCommand({
					label: 'Echo',
					command: { executable: 'true', args: [], cwd: null },
					commandSecretEnv: {},
					root: false,
					timeoutMs: 30_000,
				}),
			).resolves.toEqual({
				ok: false,
				error: {
					type: 'sandbox-operation-failed',
					operation: 'run-command',
					summary: 'Sandbox runtime environment store is invalid.',
				},
			})
		})

		it('wipes runtime env before release and succeeds when wipe fails but raw release succeeds', async () => {
			const warnings: unknown[] = []
			const fake = fakeRawSandboxProvider({ writeFile: () => Promise.reject(new Error('no write')) })
			const provider = manageSandboxProvider(fake.provider, {
				logger: { debug: () => {}, info: () => {}, warn: (_message, context) => warnings.push(context), error: () => {} },
			})
			const created = await provider.create({ key: 'agent-run-key', config: fakeConfig() })
			if (!created.ok) throw new Error('Expected sandbox creation to pass.')

			await expect(created.value.release()).resolves.toEqual({ ok: true, value: { summary: 'released' } })
			expect(warnings).toEqual([{ sandboxKey: 'agent-run-key' }])
		})
	})

	function fakeRawSandboxProvider(overrides: Partial<FakeRawSandboxOptions> = {}) {
		const files = overrides.files ?? new Map<string, string>()
		const commands: RawSandboxRunCommandInput[] = []
		const fake: FakeRawSandboxOptions = {
			files,
			commands,
			nextCommandOutput: { exitCode: 0, summary: 'raw summary', stdout: null, stderr: null },
			readFile: (path) => Promise.resolve(files.get(path) ?? null),
			writeFile: (path, contents) => {
				files.set(path, contents)
				return Promise.resolve()
			},
			release: () => Promise.resolve({ summary: 'released' }),
			...overrides,
		}
		return {
			files,
			commands,
			get nextCommandOutput() {
				return fake.nextCommandOutput
			},
			set nextCommandOutput(output: SandboxCommandOutput) {
				fake.nextCommandOutput = output
			},
			provider: {
				kind: 'consumer-managed' as const,
				create: () => Promise.resolve(raw(fake)),
				find: () => Promise.resolve(raw(fake)),
			},
		}
	}

	interface FakeRawSandboxOptions {
		files: Map<string, string>
		commands: RawSandboxRunCommandInput[]
		nextCommandOutput: SandboxCommandOutput
		readFile(path: string): Promise<string | null>
		writeFile(path: string, contents: string): Promise<void>
		release(): Promise<SandboxReleaseOutput>
	}

	function raw(fake: FakeRawSandboxOptions): RawSandbox {
		return {
			runCommand: (input) => {
				fake.commands.push(input)
				return Promise.resolve(fake.nextCommandOutput)
			},
			readFile: (path) => fake.readFile(path),
			writeFile: (path, contents) => fake.writeFile(path, contents),
			release: () => fake.release(),
		}
	}

	function fakeConfig(): AgentRunSandboxConfigForSource<Extract<AgentRunSandboxSourceConfig, { type: 'consumer-managed' }>> {
		return {
			source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
			resources: { vcpus: 1 },
			networkPolicy: { type: 'allow-all' },
		}
	}
}
