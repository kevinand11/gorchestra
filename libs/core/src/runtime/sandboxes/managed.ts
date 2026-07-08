import { normalize } from 'node:path/posix'

import { v } from 'valleyed'

import type { AgentRunSandboxSourceConfig } from '../../domain/agent-run-runtime'
import { envNamePipe } from '../../domain/secret'
import type { InvalidCoreServiceOutputError, SandboxOperationFailedError } from '../../errors'
import {
	rawSandboxPipe,
	sandboxCommandOutputPipe,
	sandboxListDirectoryOutputPipe,
	sandboxReadFileOutputPipe,
	sandboxReleaseOutputPipe,
	type AgentRunSandboxConfigForSource,
	type CoreLogger,
	type RawSandbox,
	type RawSandboxProvider,
	type RawSandboxRunCommandInput,
	type SandboxCommandOutput,
	type SandboxListDirectoryOutput,
	type SandboxReadFileOutput,
	type SandboxReleaseOutput,
} from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

const managedInternalDirectory = '/workspace/.gorchestra'
const runtimeEnvStorePath = `${managedInternalDirectory}/runtime-env.json`
const commandOutputLimitBytes = 16 * 1024
const runtimeEnvFilePipe = v.fromJson(v.record(envNamePipe, v.string()))

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
	readFile(input: { path: string }): Promise<Result<SandboxReadFileOutput, ManagedSandboxError>>
	writeFile(input: { path: string; contentsBase64: string }): Promise<Result<void, ManagedSandboxError>>
	listDirectory(input: { path: string }): Promise<Result<SandboxListDirectoryOutput, ManagedSandboxError>>
	deletePath(input: { path: string }): Promise<Result<void, ManagedSandboxError>>
	redactText(input: { text: string }): Promise<Result<string, ManagedSandboxError>>
	redactJson(input: { value: unknown }): Promise<Result<unknown, ManagedSandboxError>>
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

export interface ManagedSandboxFileApiReadinessFailedError {
	type: 'sandbox-file-api-readiness-failed'
	summary: string
}

export type ManagedSandboxFileApiReadinessError = ManagedSandboxError | ManagedSandboxFileApiReadinessFailedError

export function managedSandboxFileApiReadinessDirectory(key: string): string {
	return `/workspace/gorchestra-file-api-check-${key}`
}

export async function verifyManagedSandboxFileApiReadiness(input: {
	sandbox: ManagedSandbox
	directoryPath: string
}): Promise<Result<void, ManagedSandboxFileApiReadinessError>> {
	const filePath = `${input.directoryPath}/check.txt`
	const expectedContentsBase64 = Buffer.from('Gorchestra sandbox file API readiness check.\n').toString('base64')

	const write = await input.sandbox.writeFile({ path: filePath, contentsBase64: expectedContentsBase64 })
	if (!write.ok) return write

	const read = await input.sandbox.readFile({ path: filePath })
	if (!read.ok) return read
	if (read.value?.type !== 'file' || read.value.contentsBase64 !== expectedContentsBase64) return fileApiReadinessFailed()

	const listed = await input.sandbox.listDirectory({ path: input.directoryPath })
	if (!listed.ok) return listed
	if (listed.value?.type !== 'directory' || !listed.value.entries.some((entry) => entry.name === 'check.txt' && entry.type === 'file')) {
		return fileApiReadinessFailed()
	}

	const deleted = await input.sandbox.deletePath({ path: input.directoryPath })
	if (!deleted.ok) return deleted

	const readDeleted = await input.sandbox.readFile({ path: filePath })
	if (!readDeleted.ok) return readDeleted
	return readDeleted.value === null ? { ok: true, value: undefined } : fileApiReadinessFailed()
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
				return validated.ok ? initializeManagedSandbox(validated.value, input.key, 'create', options) : validated
			} catch {
				return sandboxOperationFailed('create', 'Sandbox creation failed.')
			}
		},
		find: async (input) => {
			try {
				const raw = await provider.find(input)
				if (raw === null) return { ok: true, value: null }
				const validated = validateCoreServiceOutput(rawSandboxPipe, raw, 'sandbox', 'find')
				return validated.ok ? initializeManagedSandbox(validated.value, input.key, 'find', options) : validated
			} catch {
				return sandboxOperationFailed('find', 'Sandbox lookup failed.')
			}
		},
	}
}

async function initializeManagedSandbox(
	raw: RawSandbox,
	key: string,
	operation: 'create' | 'find',
	options: { logger?: CoreLogger },
): Promise<Result<ManagedSandbox, ManagedSandboxError>> {
	let output: SandboxCommandOutput
	try {
		output = await raw.runCommand({
			command: {
				executable: 'sh',
				args: ['-c', `mkdir -p ${managedInternalDirectory} && chmod 700 ${managedInternalDirectory}`],
				cwd: '/workspace',
			},
			env: {},
			root: true,
			timeoutMs: 30_000,
		})
	} catch {
		return sandboxOperationFailed(operation, 'Sandbox internal directory initialization failed.')
	}

	const validated = validateCoreServiceOutput(sandboxCommandOutputPipe, output, 'sandbox', 'runCommand')
	if (!validated.ok) return validated
	return validated.value.exitCode === 0
		? { ok: true, value: manageSandbox(raw, key, options) }
		: sandboxOperationFailed(operation, validated.value.summary)
}

function fileApiReadinessFailed(): Result<never, ManagedSandboxFileApiReadinessFailedError> {
	return { ok: false, error: { type: 'sandbox-file-api-readiness-failed', summary: 'Sandbox file API readiness check failed.' } }
}

function manageSandbox(raw: RawSandbox, key: string, options: { logger?: CoreLogger }): ManagedSandbox {
	let cachedRuntimeEnvRedactionValues: string[] | null = null

	const runtimeEnvRedactionValues = async (): Promise<Result<string[], ManagedSandboxError>> => {
		if (cachedRuntimeEnvRedactionValues !== null) return { ok: true, value: cachedRuntimeEnvRedactionValues }
		const runtimeEnv = await readRuntimeEnv(raw, 'run-command')
		if (!runtimeEnv.ok) return runtimeEnv
		cachedRuntimeEnvRedactionValues = Object.values(runtimeEnv.value).filter((value) => value.length > 0)
		return { ok: true, value: cachedRuntimeEnvRedactionValues }
	}

	return {
		setEnv: async ({ name, value }) => {
			const runtimeEnv = await readRuntimeEnv(raw, 'set-env')
			if (!runtimeEnv.ok) return runtimeEnv

			try {
				await raw.writeFile(
					runtimeEnvStorePath,
					Buffer.from(`${JSON.stringify({ ...runtimeEnv.value, [name]: value })}\n`).toString('base64'),
				)
				cachedRuntimeEnvRedactionValues = null
				return { ok: true, value: { exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null } }
			} catch {
				return sandboxOperationFailed('set-env', 'Sandbox runtime environment update failed.')
			}
		},
		runCommand: async (input) => {
			const runtimeEnv = await readRuntimeEnv(raw, 'run-command')
			if (!runtimeEnv.ok) return runtimeEnv

			const cwd = managedPublicPath(input.command.cwd ?? '/workspace', 'run-command', { allowWorkspaceRoot: true })
			if (!cwd.ok) return cwd
			const executablePolicy = managedCommandExecutablePolicy(input.command.executable, cwd.value)
			if (!executablePolicy.ok) return executablePolicy

			const env = { ...runtimeEnv.value, ...input.commandSecretEnv }
			const redactedValues = [...Object.values(runtimeEnv.value), ...Object.values(input.commandSecretEnv)]
			let output: SandboxCommandOutput
			try {
				output = await raw.runCommand({
					command: { ...input.command, cwd: cwd.value },
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
		readFile: async ({ path }) => {
			const safePath = managedPublicPath(path, 'read-file', { allowWorkspaceRoot: true })
			if (!safePath.ok) return safePath
			try {
				const output = await raw.readFile(safePath.value)
				const validated = validateCoreServiceOutput(sandboxReadFileOutputPipe, output, 'sandbox', 'readFile')
				return validated.ok ? { ok: true, value: validated.value } : validated
			} catch {
				return sandboxOperationFailed('read-file', 'Sandbox file read failed.')
			}
		},
		writeFile: async ({ path, contentsBase64 }) => {
			const safePath = managedPublicPath(path, 'write-file', { allowWorkspaceRoot: false })
			if (!safePath.ok) return safePath
			try {
				await raw.writeFile(safePath.value, contentsBase64)
				return { ok: true, value: undefined }
			} catch {
				return sandboxOperationFailed('write-file', 'Sandbox file write failed.')
			}
		},
		listDirectory: async ({ path }) => {
			const safePath = managedPublicPath(path, 'list-directory', { allowWorkspaceRoot: true })
			if (!safePath.ok) return safePath
			try {
				const output = await raw.listDirectory(safePath.value)
				const validated = validateCoreServiceOutput(sandboxListDirectoryOutputPipe, output, 'sandbox', 'listDirectory')
				return validated.ok ? { ok: true, value: validated.value } : validated
			} catch {
				return sandboxOperationFailed('list-directory', 'Sandbox directory listing failed.')
			}
		},
		deletePath: async ({ path }) => {
			const safePath = managedPublicPath(path, 'delete-path', { allowWorkspaceRoot: false })
			if (!safePath.ok) return safePath
			try {
				await raw.deletePath(safePath.value)
				return { ok: true, value: undefined }
			} catch {
				return sandboxOperationFailed('delete-path', 'Sandbox path deletion failed.')
			}
		},
		redactText: async ({ text }) => {
			const redactionValues = await runtimeEnvRedactionValues()
			return redactionValues.ok ? { ok: true, value: redactString(text, redactionValues.value) } : redactionValues
		},
		redactJson: async ({ value }) => {
			const redactionValues = await runtimeEnvRedactionValues()
			return redactionValues.ok ? { ok: true, value: redactJsonValue(value, redactionValues.value, new WeakSet()) } : redactionValues
		},
		release: async () => {
			let wipeFailed = false
			try {
				await raw.writeFile(runtimeEnvStorePath, Buffer.from('{}\n').toString('base64'))
			} catch {
				wipeFailed = true
			}

			let output: SandboxReleaseOutput
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

function managedPublicPath(
	inputPath: string,
	operation: SandboxOperationFailedError['operation'],
	options: { allowWorkspaceRoot: boolean },
): Result<string, ManagedSandboxError> {
	const absolutePath = inputPath.startsWith('/') ? inputPath : `/workspace/${inputPath}`
	const path = normalize(absolutePath)
	if (path !== '/workspace' && !path.startsWith('/workspace/')) {
		return sandboxOperationFailed(operation, 'Sandbox path must be under /workspace.')
	}
	if (!options.allowWorkspaceRoot && path === '/workspace') {
		return sandboxOperationFailed(operation, 'Sandbox operation cannot target /workspace directly.')
	}
	if (path === managedInternalDirectory || path.startsWith(`${managedInternalDirectory}/`)) {
		return sandboxOperationFailed(operation, 'Sandbox path is managed by Gorchestra.')
	}
	return { ok: true, value: path }
}

function managedCommandExecutablePolicy(executable: string, cwd: string): Result<void, ManagedSandboxError> {
	if (!executable.includes('/')) return { ok: true, value: undefined }
	const executablePath = executable.startsWith('/') ? normalize(executable) : normalize(`${cwd}/${executable}`)
	return executablePath === managedInternalDirectory || executablePath.startsWith(`${managedInternalDirectory}/`)
		? sandboxOperationFailed('run-command', 'Sandbox command executable is managed by Gorchestra.')
		: { ok: true, value: undefined }
}

async function readRuntimeEnv(
	raw: RawSandbox,
	operation: 'set-env' | 'run-command',
): Promise<Result<Record<string, string>, ManagedSandboxError>> {
	let contents: SandboxReadFileOutput
	try {
		contents = await raw.readFile(runtimeEnvStorePath)
	} catch {
		return sandboxOperationFailed(operation, 'Sandbox runtime environment read failed.')
	}

	const readOutput = validateCoreServiceOutput(sandboxReadFileOutputPipe, contents, 'sandbox', 'readFile')
	if (!readOutput.ok) return readOutput
	if (readOutput.value === null) return { ok: true, value: {} }
	if (readOutput.value.type !== 'file') return sandboxOperationFailed(operation, 'Sandbox runtime environment store is invalid.')

	const parsed = v.validate(runtimeEnvFilePipe, Buffer.from(readOutput.value.contentsBase64, 'base64').toString('utf8'))
	return parsed.valid
		? { ok: true, value: parsed.value }
		: sandboxOperationFailed(operation, 'Sandbox runtime environment store is invalid.')
}

function redactJsonValue(value: unknown, secrets: string[], seen: WeakSet<object>): unknown {
	if (typeof value === 'string') return redactString(value, secrets)
	if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, secrets, seen))
	if (typeof value !== 'object' || value === null) return value
	if (seen.has(value)) return '[Circular]'
	seen.add(value)
	return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactJsonValue(nested, secrets, seen)]))
}

function redactString(value: string, secrets: string[]): string {
	return secrets.reduce((current, secret) => current.split(secret).join('[REDACTED]'), value)
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
		it('manages workspace file APIs and denies protected paths', async () => {
			const fake = fakeRawSandboxProvider()
			const provider = manageSandboxProvider(fake.provider)
			const created = await provider.create({ key: 'agent-run-key', config: fakeConfig() })
			if (!created.ok) throw new Error('Expected sandbox creation to pass.')

			await expect(
				created.value.writeFile({ path: 'notes/todo.txt', contentsBase64: Buffer.from('hello').toString('base64') }),
			).resolves.toEqual({ ok: true, value: undefined })
			await expect(created.value.readFile({ path: '/workspace/notes/todo.txt' })).resolves.toEqual({
				ok: true,
				value: { type: 'file', contentsBase64: Buffer.from('hello').toString('base64') },
			})
			await expect(created.value.listDirectory({ path: '/workspace/notes' })).resolves.toEqual({
				ok: true,
				value: { type: 'directory', entries: [{ name: 'todo.txt', type: 'file' }] },
			})
			await expect(created.value.deletePath({ path: '/workspace/notes' })).resolves.toEqual({ ok: true, value: undefined })
			await expect(created.value.readFile({ path: '/workspace/notes/todo.txt' })).resolves.toEqual({ ok: true, value: null })

			await expect(created.value.readFile({ path: '/workspace/.gorchestra/runtime-env.json' })).resolves.toMatchObject({
				ok: false,
				error: { type: 'sandbox-operation-failed', operation: 'read-file' },
			})
			await expect(created.value.deletePath({ path: '/workspace' })).resolves.toMatchObject({
				ok: false,
				error: { type: 'sandbox-operation-failed', operation: 'delete-path' },
			})
		})

		it('redacts runtime environment values from text and JSON and invalidates the cache after setEnv', async () => {
			const fake = fakeRawSandboxProvider()
			const provider = manageSandboxProvider(fake.provider)
			const created = await provider.create({ key: 'agent-run-key', config: fakeConfig() })
			if (!created.ok) throw new Error('Expected sandbox creation to pass.')

			await expect(created.value.setEnv({ name: 'NPM_TOKEN', value: 'prepared-secret' })).resolves.toMatchObject({ ok: true })
			await expect(created.value.redactText({ text: 'prepared-secret stays private' })).resolves.toEqual({
				ok: true,
				value: '[REDACTED] stays private',
			})
			await expect(
				created.value.redactJson({ value: { nested: ['prepared-secret', 7], text: 'prefix prepared-secret suffix' } }),
			).resolves.toEqual({
				ok: true,
				value: { nested: ['[REDACTED]', 7], text: 'prefix [REDACTED] suffix' },
			})

			await expect(created.value.setEnv({ name: 'NPM_TOKEN', value: 'new-secret' })).resolves.toMatchObject({ ok: true })
			await expect(created.value.redactText({ text: 'prepared-secret new-secret' })).resolves.toEqual({
				ok: true,
				value: 'prepared-secret [REDACTED]',
			})
		})

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

			expect(fake.commands.at(-1)).toEqual({
				command: { executable: 'printenv', args: ['NPM_TOKEN'], cwd: '/workspace' },
				env: { NPM_TOKEN: 'command-secret' },
				root: false,
				timeoutMs: 30_000,
			})
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
			readFile: (path) => Promise.resolve(fakeReadFile(files, path)),
			writeFile: (path, contentsBase64) => {
				files.set(path, Buffer.from(contentsBase64, 'base64').toString('utf8'))
				return Promise.resolve()
			},
			listDirectory: (path) => Promise.resolve(fakeListDirectory(files, path)),
			deletePath: (path) => {
				for (const filePath of [...files.keys()]) {
					if (filePath === path || filePath.startsWith(`${path}/`)) files.delete(filePath)
				}
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
		readFile(path: string): Promise<SandboxReadFileOutput>
		writeFile(path: string, contentsBase64: string): Promise<void>
		listDirectory(path: string): Promise<SandboxListDirectoryOutput>
		deletePath(path: string): Promise<void>
		release(): Promise<SandboxReleaseOutput>
	}

	function raw(fake: FakeRawSandboxOptions): RawSandbox {
		return {
			runCommand: (input) => {
				fake.commands.push(input)
				return Promise.resolve(fake.nextCommandOutput)
			},
			readFile: (path) => fake.readFile(path),
			writeFile: (path, contentsBase64) => fake.writeFile(path, contentsBase64),
			listDirectory: (path) => fake.listDirectory(path),
			deletePath: (path) => fake.deletePath(path),
			release: () => fake.release(),
		}
	}

	function fakeReadFile(files: Map<string, string>, path: string): SandboxReadFileOutput {
		const contents = files.get(path)
		if (contents !== undefined) return { type: 'file', contentsBase64: Buffer.from(contents).toString('base64') }
		return hasDescendant(files, path) ? { type: 'directory' } : null
	}

	function fakeListDirectory(files: Map<string, string>, path: string): SandboxListDirectoryOutput {
		if (files.has(path)) return { type: 'file' }
		const entries = new Map<string, 'file' | 'directory'>()
		for (const filePath of files.keys()) {
			if (!filePath.startsWith(`${path}/`)) continue
			const relativePath = filePath.slice(path.length + 1)
			const [name, ...rest] = relativePath.split('/')
			if (name === undefined || name.length === 0) continue
			entries.set(name, rest.length === 0 ? 'file' : 'directory')
		}
		return entries.size === 0
			? null
			: {
					type: 'directory',
					entries: [...entries]
						.map(([name, type]) => ({ name, type }))
						.sort((left, right) => left.name.localeCompare(right.name)),
				}
	}

	function hasDescendant(files: Map<string, string>, path: string): boolean {
		for (const filePath of files.keys()) {
			if (filePath.startsWith(`${path}/`)) return true
		}
		return false
	}

	function fakeConfig(): AgentRunSandboxConfigForSource<Extract<AgentRunSandboxSourceConfig, { type: 'consumer-managed' }>> {
		return {
			source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
			resources: { vcpus: 1 },
			networkPolicy: { type: 'allow-all' },
		}
	}
}
