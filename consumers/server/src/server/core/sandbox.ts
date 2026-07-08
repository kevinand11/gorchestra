import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { CoreServices, RawSandboxRunCommandInput } from '@gorchestra/core'
import {
	Destination,
	type MountBuilder,
	type NetworkBuilder,
	NetworkPolicy,
	type PatchBuilder,
	Rule,
	Sandbox,
	type SandboxBuilder,
	type SandboxFsOps,
	SandboxNotFoundError,
} from 'microsandbox'

export interface MicrosandboxSandboxProviderInput {
	coreStorageNamespace: string
	sandboxRootDir: string
}

const workspacePath = '/workspace'

interface ConsumerManagedSandboxConfig {
	source: { type: 'consumer-managed'; ociImage: string }
	resources: { vcpus: number }
	networkPolicy:
		| { type: 'allow-all' }
		| { type: 'deny-all' }
		| { type: 'allow-list'; hosts: string[]; subnets: { allow: string[]; deny: string[] } }
}

export function createMicrosandboxSandboxProvider(input: MicrosandboxSandboxProviderInput): CoreServices['sandbox'] {
	return {
		kind: 'consumer-managed',
		create: async ({ key, config }) => {
			const name = microsandboxName(input.coreStorageNamespace, key)
			const hostWorkspaceDir = hostSandboxWorkspaceDir(input.sandboxRootDir, name)
			return microsandboxCoreSandbox(name, await createMicrosandboxSandbox(name, config, hostWorkspaceDir))
		},
		find: async ({ key }) => {
			const name = microsandboxName(input.coreStorageNamespace, key)
			const sandbox = await findMicrosandboxSandbox(name)
			return sandbox === null ? null : microsandboxCoreSandbox(name, sandbox)
		},
	}
}

function microsandboxCoreSandbox(name: string, sandbox: Sandbox) {
	return {
		runCommand: (input: RawSandboxRunCommandInput) => runExternalCommand(sandbox, input),
		readFile: (path: string) => readFile(sandbox, path),
		writeFile: (path: string, contents: string) => writeFile(sandbox, path, contents),
		release: () => releaseSandbox(sandbox, name),
	}
}

async function createMicrosandboxSandbox(name: string, config: ConsumerManagedSandboxConfig, hostWorkspaceDir: string): Promise<Sandbox> {
	await mkdir(hostWorkspaceDir, { recursive: true })

	let builder = Sandbox.builder(name)
		.image(config.source.ociImage)
		.cpus(config.resources.vcpus)
		.memory(sandboxMemoryMiBForVcpus(config.resources.vcpus))
		.patch((patch) => patchBuilder(patch).mkdir(workspacePath))
		.volume(workspacePath, (mount) => mountBuilder(mount).bind(hostWorkspaceDir))
		.detached(true)
		.replace()

	builder = applyNetworkPolicy(builder, config.networkPolicy)
	return builder.create()
}

async function findMicrosandboxSandbox(name: string): Promise<Sandbox | null> {
	try {
		const handle = await Sandbox.get(name)
		if (handle.status === 'stopped') return Sandbox.startDetached(name)
		if (handle.status === 'running') return handle.connect()
		return null
	} catch (error) {
		if (isMicrosandboxNotFoundError(error)) return null
		throw error instanceof Error ? error : new Error(String(error))
	}
}

async function runExternalCommand(sandbox: Sandbox, input: RawSandboxRunCommandInput) {
	const output = await sandbox.execWith(input.command.executable, (exec) => {
		let configured = exec.args(input.command.args).cwd(input.command.cwd).envs(input.env).timeout(input.timeoutMs)
		if (input.root) configured = configured.user('root')
		return configured
	})
	return {
		exitCode: output.code,
		summary: output.code === 0 ? 'Command completed.' : `Command exited with status ${output.code}.`,
		stdout: output.stdout(),
		stderr: output.stderr(),
	}
}

async function readFile(sandbox: Sandbox, path: string): Promise<string | null> {
	const fs = sandbox.fs()
	return (await fs.exists(path)) ? fs.readToString(path) : null
}

async function writeFile(sandbox: Sandbox, path: string, contents: string): Promise<void> {
	const fs = sandbox.fs()
	await ensureDir(fs, parentDir(path))
	await fs.write(path, contents)
}

async function ensureDir(fs: SandboxFsOps, path: string): Promise<void> {
	if (path === '/' || (await fs.exists(path))) return
	await ensureDir(fs, parentDir(path))
	await fs.mkdir(path)
}

function parentDir(path: string): string {
	const index = path.lastIndexOf('/')
	return index <= 0 ? '/' : path.slice(0, index)
}

async function releaseSandbox(sandbox: Sandbox, name: string) {
	await sandbox.stop()
	await Sandbox.remove(name)
	return { summary: 'Sandbox released.' }
}

function sandboxMemoryMiBForVcpus(vcpus: number): number {
	return vcpus * 2048
}

function hostSandboxWorkspaceDir(sandboxRootDir: string, name: string): string {
	return join(sandboxRootDir, 'sandboxes', name)
}

function microsandboxName(coreStorageNamespace: string, key: string): string {
	const digest = createHash('sha256').update(coreStorageNamespace).update('\0').update(key).digest('base64url')
	return `gorchestra-${digest}`
}

function applyNetworkPolicy(builder: SandboxBuilder, policy: ConsumerManagedSandboxConfig['networkPolicy']): SandboxBuilder {
	switch (policy.type) {
		case 'allow-all':
			return builder
		case 'deny-all':
			return builder.network((network) => networkBuilder(network).policy(NetworkPolicy.none()))
		case 'allow-list':
			return builder.network((network) =>
				networkBuilder(network).policy({
					defaultEgress: 'deny',
					defaultIngress: 'allow',
					rules: [
						...policy.subnets.deny.map((subnet) => microsandboxSubnetRule('deny', subnet)),
						...policy.hosts.map((host) => microsandboxHostRule(host)),
						...policy.subnets.allow.map((subnet) => microsandboxSubnetRule('allow', subnet)),
					],
				}),
			)
		default:
			throw new Error(`Unexpected sandbox network policy: ${String(policy satisfies never)}`)
	}
}

function networkBuilder(network: unknown) {
	return network as InstanceType<typeof NetworkBuilder>
}

function patchBuilder(patch: unknown) {
	return patch as InstanceType<typeof PatchBuilder>
}

function mountBuilder(mount: unknown) {
	return mount as InstanceType<typeof MountBuilder>
}

function microsandboxHostRule(host: string) {
	return Rule.allowEgress(Destination.domain(host))
}

function microsandboxSubnetRule(action: 'allow' | 'deny', subnet: string) {
	const destination = Destination.cidr(subnet)
	return action === 'allow' ? Rule.allowEgress(destination) : Rule.denyEgress(destination)
}

function isMicrosandboxNotFoundError(error: unknown): boolean {
	return error instanceof SandboxNotFoundError
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Microsandbox sandbox provider helpers', () => {
		it('creates deterministic namespaced sandbox names', () => {
			expect(microsandboxName('portfolio-1', 'agent-run-1')).toMatch(/^gorchestra-[A-Za-z0-9_-]+$/)
			expect(microsandboxName('portfolio-1', 'agent-run-1')).toBe(microsandboxName('portfolio-1', 'agent-run-1'))
			expect(microsandboxName('portfolio-1', 'agent-run-1')).not.toBe(microsandboxName('portfolio-2', 'agent-run-1'))
		})

		it('derives parent directories for sandbox file writes', () => {
			expect(parentDir('/workspace/.gorchestra/runtime-env.json')).toBe('/workspace/.gorchestra')
			expect(parentDir('/workspace')).toBe('/')
			expect(parentDir('/')).toBe('/')
		})

		it('derives host workspace directories for bound sandboxes', () => {
			expect(hostSandboxWorkspaceDir('/data/gorchestra', 'gorchestra-abc')).toBe(
				join('/data/gorchestra', 'sandboxes', 'gorchestra-abc'),
			)
		})

		it('recognizes Microsandbox not-found errors', () => {
			expect(isMicrosandboxNotFoundError(new SandboxNotFoundError('missing'))).toBe(true)
			expect(isMicrosandboxNotFoundError(new Error('missing'))).toBe(false)
		})
	})
}
