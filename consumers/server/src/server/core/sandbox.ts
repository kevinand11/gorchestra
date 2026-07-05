import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { CoreServices, SandboxRunCommandInput } from '@gorchestra/core'

export interface LocalDirectorySandboxServiceInput {
	rootDir: string
	coreStorageNamespace: string
}

const envSecretValueName = 'GORCHESTRA_SECRET_VALUE'
const envFileName = 'env.json'
const outputLimitBytes = 16 * 1024

export function createLocalDirectorySandboxService(input: LocalDirectorySandboxServiceInput): CoreServices['sandbox'] {
	return {
		preflight: async () => {
			try {
				await mkdir(sandboxesRoot(input.rootDir), { recursive: true })
				return { ok: true }
			} catch (error) {
				return { ok: false, message: error instanceof Error ? error.message : null }
			}
		},
		assign: async ({ agentRunId }) => {
			const ref = sandboxRef(input.coreStorageNamespace, agentRunId)
			await mkdir(workspaceDir(input.rootDir, ref), { recursive: true })
			await mkdir(runtimeDir(input.rootDir, ref), { recursive: true })
			await ensureRuntimeEnvFile(input.rootDir, ref)
			return { ref }
		},
		runCommand: (commandInput) => runCommand(input.rootDir, commandInput),
		release: async ({ ref }) => {
			await rm(sandboxDir(input.rootDir, ref), { recursive: true, force: true })
			return { summary: 'Sandbox released.' }
		},
	}
}

async function runCommand(rootDir: string, input: SandboxRunCommandInput) {
	if (input.command.executable === 'gorchestra-env') return runInternalEnvironmentCommand(rootDir, input)
	return runExternalCommand(rootDir, input)
}

async function runInternalEnvironmentCommand(rootDir: string, input: SandboxRunCommandInput) {
	const [operation, envName] = input.command.args
	if (operation !== 'set' || envName === undefined || !isEnvName(envName)) {
		return { exitCode: 2, summary: 'Invalid sandbox environment command.', stdout: null, stderr: null }
	}

	const value = input.commandSecretEnv[envSecretValueName]
	if (value === undefined)
		return { exitCode: 2, summary: 'Sandbox environment Secret value was not provided.', stdout: null, stderr: null }

	const runtimeEnv = await readRuntimeEnv(rootDir, input.ref)
	runtimeEnv[envName] = value
	await writeRuntimeEnv(rootDir, input.ref, runtimeEnv)
	return { exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null }
}

async function runExternalCommand(rootDir: string, input: SandboxRunCommandInput) {
	const cwd = commandCwd(rootDir, input.ref, input.command.cwd)
	if (cwd === null) return { exitCode: 2, summary: 'Command cwd must stay inside the sandbox workspace.', stdout: null, stderr: null }

	const runtimeEnv = await readRuntimeEnv(rootDir, input.ref)
	return spawnCommand(input, cwd, { ...process.env, ...runtimeEnv, ...input.commandSecretEnv }, [
		...Object.values(runtimeEnv),
		...Object.values(input.commandSecretEnv),
	])
}

function spawnCommand(input: SandboxRunCommandInput, cwd: string, env: NodeJS.ProcessEnv, redactedValues: string[]) {
	return new Promise<{ exitCode: number; summary: string; stdout: string | null; stderr: string | null }>((resolve) => {
		const child = spawn(input.command.executable, input.command.args, { cwd, env, shell: false })
		const stdout = limitedCollector()
		const stderr = limitedCollector()
		let timedOut = false
		const timeout = setTimeout(() => {
			timedOut = true
			child.kill('SIGTERM')
		}, input.timeoutMs)

		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
		child.on('error', () => {
			clearTimeout(timeout)
			resolve({ exitCode: 127, summary: 'Command could not be started.', stdout: null, stderr: null })
		})
		child.on('close', (code) => {
			clearTimeout(timeout)
			const exitCode = timedOut ? 124 : (code ?? 1)
			resolve({
				exitCode,
				summary: timedOut
					? 'Command timed out.'
					: exitCode === 0
						? 'Command completed.'
						: `Command exited with status ${exitCode}.`,
				stdout: redact(stdout.value(), redactedValues),
				stderr: redact(stderr.value(), redactedValues),
			})
		})
	})
}

function limitedCollector() {
	const chunks: Buffer[] = []
	let bytes = 0
	return {
		push(chunk: Buffer) {
			if (bytes >= outputLimitBytes) return
			const remaining = outputLimitBytes - bytes
			const captured = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
			chunks.push(captured)
			bytes += captured.byteLength
		},
		value() {
			if (chunks.length === 0) return null
			return Buffer.concat(chunks).toString('utf8')
		},
	}
}

function redact(value: string | null, secrets: string[]): string | null {
	if (value === null) return null
	return secrets.filter((secret) => secret.length > 0).reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), value)
}

function sandboxRef(coreStorageNamespace: string, agentRunId: string): string {
	return `${encodeURIComponent(coreStorageNamespace)}/${encodeURIComponent(agentRunId)}`
}

function sandboxesRoot(rootDir: string): string {
	return path.join(rootDir, 'sandboxes')
}

function sandboxDir(rootDir: string, ref: string): string {
	return safeJoin(sandboxesRoot(rootDir), ref)
}

function workspaceDir(rootDir: string, ref: string): string {
	return path.join(sandboxDir(rootDir, ref), 'workspace')
}

function runtimeDir(rootDir: string, ref: string): string {
	return path.join(sandboxDir(rootDir, ref), 'runtime')
}

function runtimeEnvPath(rootDir: string, ref: string): string {
	return path.join(runtimeDir(rootDir, ref), envFileName)
}

async function ensureRuntimeEnvFile(rootDir: string, ref: string): Promise<void> {
	try {
		await readFile(runtimeEnvPath(rootDir, ref), 'utf8')
	} catch {
		await writeRuntimeEnv(rootDir, ref, {})
	}
}

async function readRuntimeEnv(rootDir: string, ref: string): Promise<Record<string, string>> {
	await ensureRuntimeEnvFile(rootDir, ref)
	const raw = await readFile(runtimeEnvPath(rootDir, ref), 'utf8')
	const parsed = JSON.parse(raw) as unknown
	return typeof parsed === 'object' && parsed !== null
		? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
		: {}
}

async function writeRuntimeEnv(rootDir: string, ref: string, runtimeEnv: Record<string, string>): Promise<void> {
	await mkdir(runtimeDir(rootDir, ref), { recursive: true })
	await writeFile(runtimeEnvPath(rootDir, ref), `${JSON.stringify(runtimeEnv)}\n`, 'utf8')
}

function commandCwd(rootDir: string, ref: string, cwd: string | null): string | null {
	const workspace = workspaceDir(rootDir, ref)
	if (cwd === null || cwd === '/workspace') return workspace
	if (!cwd.startsWith('/workspace/') || cwd.split('/').includes('..')) return null
	return safeJoin(workspace, cwd.slice('/workspace/'.length))
}

function safeJoin(root: string, child: string): string {
	const resolvedRoot = path.resolve(root)
	const resolvedChild = path.resolve(root, child)
	if (resolvedChild !== resolvedRoot && !resolvedChild.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error('Path escaped sandbox root.')
	}
	return resolvedChild
}

function isEnvName(value: string): boolean {
	return /^[A-Z_][A-Z0-9_]*$/.test(value)
}

if (import.meta.vitest) {
	const { afterEach, describe, expect, it } = import.meta.vitest
	const { mkdtemp } = await import('node:fs/promises')
	const { tmpdir } = await import('node:os')

	const tempDirs: string[] = []
	afterEach(async () => {
		await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })))
		tempDirs.length = 0
	})

	describe('Local directory sandbox service', () => {
		it('assigns a durable workspace, stores runtime env, runs commands, and releases the directory', async () => {
			const rootDir = await mkdtemp(path.join(tmpdir(), 'gorchestra-sandbox-'))
			tempDirs.push(rootDir)
			const sandbox = createLocalDirectorySandboxService({ rootDir, coreStorageNamespace: 'portfolio-1' })

			const assigned = await sandbox.assign({ agentRunId: 'agent-run-1' })
			expect(assigned).toEqual({ ref: 'portfolio-1/agent-run-1' })
			if (typeof assigned !== 'object' || assigned === null || !('ref' in assigned) || typeof assigned.ref !== 'string') return

			await expect(
				sandbox.runCommand({
					ref: assigned.ref,
					label: 'Set token',
					command: { executable: 'gorchestra-env', args: ['set', 'NPM_TOKEN'], cwd: null },
					commandSecretEnv: { GORCHESTRA_SECRET_VALUE: 'secret-value' },
					timeoutMs: 1000,
				}),
			).resolves.toMatchObject({ exitCode: 0 })

			await expect(
				sandbox.runCommand({
					ref: assigned.ref,
					label: 'Read token',
					command: {
						executable: process.execPath,
						args: ['-e', 'process.stdout.write(process.env.NPM_TOKEN ?? "")'],
						cwd: '/workspace',
					},
					commandSecretEnv: {},
					timeoutMs: 1000,
				}),
			).resolves.toMatchObject({ exitCode: 0, stdout: '[REDACTED]' })

			await expect(sandbox.release({ ref: assigned.ref })).resolves.toEqual({ summary: 'Sandbox released.' })
		})
	})
}
