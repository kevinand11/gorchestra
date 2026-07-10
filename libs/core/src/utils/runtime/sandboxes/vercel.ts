import { dirname } from 'node:path/posix'

import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { AgentRunSandboxNetworkPolicy, AgentRunSandboxSourceConfig } from '../../../domain/agent-run-runtime'
import type { RawSandbox, RawSandboxProvider, RawSandboxRunCommandInput } from '../../../services'

type VercelSandboxSourceConfig = Extract<AgentRunSandboxSourceConfig, { type: 'vercel-runtime' | 'vercel-vcr-image' }>

export interface VercelCredentials {
	token: string
	teamId: string
	projectId: string
}

interface VercelSandboxProviderInput {
	source: VercelSandboxSourceConfig
	credentials: VercelCredentials
}

export function createVercelSandboxProvider(input: VercelSandboxProviderInput): RawSandboxProvider<VercelSandboxSourceConfig> {
	return {
		kind: input.source.type,
		create: async ({ key, config }) =>
			vercelRawSandbox(
				await VercelSandbox.getOrCreate({
					...input.credentials,
					...vercelSourceParams(input.source),
					name: key,
					persistent: true,
					resources: { vcpus: config.resources.vcpus },
					networkPolicy: vercelNetworkPolicy(config.networkPolicy),
					onCreate: ensureVercelWorkspaceDirectory,
					onResume: ensureVercelWorkspaceDirectory,
				}),
			),
		find: async ({ key }) => {
			try {
				return vercelRawSandbox(
					await VercelSandbox.get({
						...input.credentials,
						name: key,
						resume: true,
						onResume: ensureVercelWorkspaceDirectory,
					}),
				)
			} catch {
				return null
			}
		},
	}
}

function vercelSourceParams(source: VercelSandboxSourceConfig) {
	switch (source.type) {
		case 'vercel-runtime':
			return { runtime: source.runtime }
		case 'vercel-vcr-image':
			return { image: source.vcrImage }
		default:
			throw new Error(`Unexpected Vercel sandbox source type: ${String(source satisfies never)}`)
	}
}

function vercelNetworkPolicy(policy: AgentRunSandboxNetworkPolicy) {
	switch (policy.type) {
		case 'allow-all':
			return 'allow-all'
		case 'deny-all':
			return 'deny-all'
		case 'allow-list':
			return { allow: policy.hosts, subnets: { allow: policy.subnets.allow, deny: policy.subnets.deny } }
		default:
			throw new Error(`Unexpected Agent Run Sandbox network policy type: ${String(policy satisfies never)}`)
	}
}

function vercelRawSandbox(handle: VercelSandbox): RawSandbox {
	return {
		runCommand: (input) => runVercelCommand(handle, input),
		readFile: async (path) => {
			const fsPath = vercelFsPath(path)
			try {
				const stat = await handle.fs.stat(fsPath)
				if (stat.isDirectory()) return { type: 'directory' }
				if (!stat.isFile()) return { type: 'other' }
				return { type: 'file', contentsBase64: (await handle.fs.readFile(fsPath, null)).toString('base64') }
			} catch (error) {
				if (isFileNotFoundError(error)) return null
				throw error
			}
		},
		writeFile: async (path, contentsBase64) => {
			const fsPath = vercelFsPath(path)
			await handle.fs.mkdir(dirname(fsPath), { recursive: true })
			await handle.fs.writeFile(fsPath, Buffer.from(contentsBase64, 'base64'))
		},
		listDirectory: async (path) => {
			const fsPath = vercelFsPath(path)
			try {
				const stat = await handle.fs.stat(fsPath)
				if (stat.isFile()) return { type: 'file' }
				if (!stat.isDirectory()) return { type: 'other' }
				const entries = await handle.fs.readdir(fsPath, { withFileTypes: true })
				return {
					type: 'directory',
					entries: entries.map((entry) => ({ name: entry.name, type: vercelDirentType(entry) })),
				}
			} catch (error) {
				if (isFileNotFoundError(error)) return null
				throw error
			}
		},
		deletePath: async (path) => {
			await handle.fs.rm(vercelFsPath(path), { recursive: true, force: true })
		},
		release: async () => {
			await handle.delete()
			return { summary: 'Sandbox released.' }
		},
	}
}

async function runVercelCommand(handle: VercelSandbox, input: RawSandboxRunCommandInput) {
	const result = await handle.runCommand({
		cmd: input.command.executable,
		args: input.command.args,
		cwd: vercelFsPath(input.command.cwd),
		env: input.env,
		sudo: input.root,
		timeoutMs: input.timeoutMs,
	})
	return {
		exitCode: result.exitCode,
		summary: result.exitCode === 0 ? 'Command completed.' : `Command exited with status ${result.exitCode}.`,
		stdout: await result.stdout(),
		stderr: await result.stderr(),
	}
}

async function ensureVercelWorkspaceDirectory(handle: VercelSandbox): Promise<void> {
	const mkdir = await handle.runCommand({ cmd: 'mkdir', args: ['-p', '/vercel/sandbox'], sudo: true })
	if (mkdir.exitCode !== 0) throw new Error('Failed to create Vercel sandbox workspace directory.')
}

function vercelFsPath(path: string): string {
	return path === '/workspace'
		? '/vercel/sandbox'
		: path.startsWith('/workspace/')
			? `/vercel/sandbox/${path.slice('/workspace/'.length)}`
			: path
}

function vercelDirentType(entry: { isFile(): boolean; isDirectory(): boolean }): 'file' | 'directory' | 'other' {
	if (entry.isFile()) return 'file'
	if (entry.isDirectory()) return 'directory'
	return 'other'
}

function isFileNotFoundError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Vercel sandbox provider helpers', () => {
		it('translates workspace paths to Vercel sandbox filesystem paths', () => {
			expect(vercelFsPath('/workspace')).toBe('/vercel/sandbox')
			expect(vercelFsPath('/workspace/repos/repo-1')).toBe('/vercel/sandbox/repos/repo-1')
			expect(vercelFsPath('/tmp/file')).toBe('/tmp/file')
		})
	})
}
