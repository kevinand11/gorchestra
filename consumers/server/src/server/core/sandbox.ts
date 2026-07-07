import { createHash } from 'node:crypto'

import type { CoreServices, SandboxRunCommandInput } from '@gorchestra/core'

export interface MicrosandboxSandboxRuntimeInput {
	coreStorageNamespace: string
	microsandbox?: MicrosandboxSdk
}

const envSecretValueName = 'GORCHESTRA_SECRET_VALUE'
const runtimeEnvDirPath = '/.gorchestra'
const runtimeEnvFilePath = `${runtimeEnvDirPath}/runtime-env.json`
const workspacePath = '/workspace'
const outputLimitBytes = 16 * 1024

interface ConsumerManagedSandboxConfig {
	source: { type: 'consumer-managed'; ociImage: string }
	resources: { vcpus: number }
	networkPolicy:
		| { type: 'allow-all' }
		| { type: 'deny-all' }
		| { type: 'allow-list'; hosts: string[]; subnets: { allow: string[]; deny: string[] } }
}

interface MicrosandboxSdk {
	create(input: { name: string; config: ConsumerManagedSandboxConfig }): Promise<MicrosandboxRunningSandbox>
	find(input: { name: string }): Promise<MicrosandboxRunningSandbox | null>
	remove(input: { name: string }): Promise<void>
}

interface MicrosandboxRunningSandbox {
	execWith(
		command: string,
		configure: (builder: MicrosandboxExecOptionsBuilder) => MicrosandboxExecOptionsBuilder,
	): Promise<MicrosandboxExecOutput>
	fs(): MicrosandboxFs
	stop(): Promise<void>
}

interface MicrosandboxExecOptionsBuilder {
	args(args: string[]): MicrosandboxExecOptionsBuilder
	cwd(cwd: string): MicrosandboxExecOptionsBuilder
	envs(env: Record<string, string>): MicrosandboxExecOptionsBuilder
	timeout(timeoutMs: number): MicrosandboxExecOptionsBuilder
}

interface MicrosandboxExecOutput {
	code: number
	stdout(): string
	stderr(): string
}

interface MicrosandboxFs {
	exists(path: string): Promise<boolean>
	mkdir(path: string): Promise<void>
	readToString(path: string): Promise<string>
	write(path: string, data: string): Promise<void>
}

export function createMicrosandboxSandboxRuntime(input: MicrosandboxSandboxRuntimeInput): CoreServices['sandbox'] {
	return {
		kind: 'consumer-managed',
		create: async ({ key, config }) => {
			const sdk = input.microsandbox ?? (await defaultMicrosandboxSdk())
			const sandbox = await sdk.create({ name: microsandboxName(input.coreStorageNamespace, key), config })
			return microsandboxCoreSandbox(key, microsandboxName(input.coreStorageNamespace, key), sdk, sandbox)
		},
		find: async ({ key }) => {
			const sdk = input.microsandbox ?? (await defaultMicrosandboxSdk())
			const sandbox = await sdk.find({ name: microsandboxName(input.coreStorageNamespace, key) })
			return sandbox === null ? null : microsandboxCoreSandbox(key, microsandboxName(input.coreStorageNamespace, key), sdk, sandbox)
		},
	}
}

function microsandboxCoreSandbox(key: string, name: string, sdk: MicrosandboxSdk, sandbox: MicrosandboxRunningSandbox) {
	return {
		key,
		runCommand: (input: SandboxRunCommandInput) => runCommand(sandbox, input),
		release: () => releaseSandbox(sdk, sandbox, name),
	}
}

async function runCommand(sandbox: MicrosandboxRunningSandbox, input: SandboxRunCommandInput) {
	try {
		if (isRuntimeEnvSetCommand(input)) return runInternalEnvironmentCommand(sandbox, input)
		return runExternalCommand(sandbox, input)
	} catch {
		return { exitCode: 1, summary: 'Sandbox command execution failed.', stdout: null, stderr: null }
	}
}

async function runInternalEnvironmentCommand(sandbox: MicrosandboxRunningSandbox, input: SandboxRunCommandInput) {
	const [operation, envName] = input.command.args
	if (operation !== 'set' || envName === undefined || !isEnvName(envName)) {
		return { exitCode: 2, summary: 'Invalid sandbox environment command.', stdout: null, stderr: null }
	}

	const value = input.commandSecretEnv[envSecretValueName]
	if (value === undefined)
		return { exitCode: 2, summary: 'Sandbox environment Secret value was not provided.', stdout: null, stderr: null }

	const runtimeEnv = await readRuntimeEnv(sandbox)
	if (!runtimeEnv.ok) return runtimeEnv.error

	await writeRuntimeEnv(sandbox, { ...runtimeEnv.value, [envName]: value })
	return { exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null }
}

async function runExternalCommand(sandbox: MicrosandboxRunningSandbox, input: SandboxRunCommandInput) {
	const runtimeEnv = await readRuntimeEnv(sandbox)
	if (!runtimeEnv.ok) return runtimeEnv.error

	const env = { ...runtimeEnv.value, ...input.commandSecretEnv }
	const output = await sandbox.execWith(input.command.executable, (exec) =>
		exec
			.args(input.command.args)
			.cwd(input.command.cwd ?? workspacePath)
			.envs(env)
			.timeout(input.timeoutMs),
	)
	const redactedValues = Object.values(env).filter((value) => value.length > 0)
	return commandOutput(
		output.code,
		output.code === 0 ? 'Command completed.' : `Command exited with status ${output.code}.`,
		output.stdout(),
		output.stderr(),
		redactedValues,
	)
}

async function releaseSandbox(sdk: MicrosandboxSdk, sandbox: MicrosandboxRunningSandbox, name: string) {
	await sandbox.stop()
	await sdk.remove({ name })
	return { summary: 'Sandbox released.' }
}

function isRuntimeEnvSetCommand(input: SandboxRunCommandInput): boolean {
	return input.command.executable === 'gorchestra-env' && input.command.args[0] === 'set'
}

async function readRuntimeEnv(sandbox: MicrosandboxRunningSandbox) {
	const fs = sandbox.fs()
	if (!(await fs.exists(runtimeEnvFilePath))) return { ok: true as const, value: {} }

	const parsed = JSON.parse(await fs.readToString(runtimeEnvFilePath)) as unknown
	return isStringRecord(parsed)
		? { ok: true as const, value: parsed }
		: {
				ok: false as const,
				error: { exitCode: 1, summary: 'Sandbox runtime environment store is invalid.', stdout: null, stderr: null },
			}
}

async function writeRuntimeEnv(sandbox: MicrosandboxRunningSandbox, runtimeEnv: Record<string, string>): Promise<void> {
	const fs = sandbox.fs()
	if (!(await fs.exists(runtimeEnvDirPath))) await fs.mkdir(runtimeEnvDirPath)
	await fs.write(runtimeEnvFilePath, `${JSON.stringify(runtimeEnv)}\n`)
}

function commandOutput(exitCode: number, summary: string, stdout: string, stderr: string, secrets: string[]) {
	return {
		exitCode,
		summary,
		stdout: normalizedStream(stdout, secrets),
		stderr: normalizedStream(stderr, secrets),
	}
}

function normalizedStream(value: string, secrets: string[]): string | null {
	const redacted = secrets.reduce((current, secret) => current.split(secret).join('[REDACTED]'), value)
	const truncated = truncateUtf8(redacted, outputLimitBytes)
	return truncated.length === 0 ? null : truncated
}

function truncateUtf8(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value)
	return bytes.byteLength <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8')
}

function sandboxMemoryMiBForVcpus(vcpus: number): number {
	return vcpus * 2048
}

function microsandboxName(coreStorageNamespace: string, key: string): string {
	const digest = createHash('sha256').update(coreStorageNamespace).update('\0').update(key).digest('base64url')
	return `gorchestra-${digest}`
}

async function defaultMicrosandboxSdk(): Promise<MicrosandboxSdk> {
	const mod = (await import('microsandbox')) as MicrosandboxModule
	return {
		create: async ({ name, config }) => {
			let builder = mod.Sandbox.builder(name)
				.image(config.source.ociImage)
				.cpus(config.resources.vcpus)
				.memory(sandboxMemoryMiBForVcpus(config.resources.vcpus))
				.patch((patch) => patch.mkdir(workspacePath).mkdir(runtimeEnvDirPath))
				.detached(true)
				.replace()

			builder = applyNetworkPolicy(builder, mod, config.networkPolicy)
			return builder.create()
		},
		find: async ({ name }) => {
			try {
				const handle = await mod.Sandbox.get(name)
				if (handle.status === 'stopped') return mod.Sandbox.startDetached(name)
				if (handle.status === 'running') return handle.connect()
				return null
			} catch (error) {
				if (isMicrosandboxNotFoundError(error)) return null
				throw error instanceof Error ? error : new Error(String(error))
			}
		},
		remove: ({ name }) => mod.Sandbox.remove(name),
	}
}

interface MicrosandboxModule {
	Sandbox: {
		builder(name: string): MicrosandboxBuilder
		get(name: string): Promise<MicrosandboxHandle>
		startDetached(name: string): Promise<MicrosandboxRunningSandbox>
		remove(name: string): Promise<void>
	}
	NetworkPolicy?: { none(): unknown }
	Rule?: { allowEgress(destination: unknown): unknown; denyEgress(destination: unknown): unknown }
	Destination?: { domain(host: string): unknown; cidr?(subnet: string): unknown; subnet?(subnet: string): unknown }
}

interface MicrosandboxBuilder {
	image(image: string): MicrosandboxBuilder
	cpus(vcpus: number): MicrosandboxBuilder
	memory(memoryMiB: number): MicrosandboxBuilder
	patch(configure: (patch: MicrosandboxPatchBuilder) => MicrosandboxPatchBuilder): MicrosandboxBuilder
	network(configure: (network: MicrosandboxNetworkBuilder) => MicrosandboxNetworkBuilder): MicrosandboxBuilder
	detached(enabled: boolean): MicrosandboxBuilder
	replace(): MicrosandboxBuilder
	create(): Promise<MicrosandboxRunningSandbox>
}

interface MicrosandboxPatchBuilder {
	mkdir(path: string): MicrosandboxPatchBuilder
}

interface MicrosandboxNetworkBuilder {
	policy(policy: unknown): MicrosandboxNetworkBuilder
}

interface MicrosandboxHandle {
	status: string
	connect(): Promise<MicrosandboxRunningSandbox>
}

function applyNetworkPolicy(
	builder: MicrosandboxBuilder,
	mod: MicrosandboxModule,
	policy: ConsumerManagedSandboxConfig['networkPolicy'],
): MicrosandboxBuilder {
	switch (policy.type) {
		case 'allow-all':
			return builder
		case 'deny-all':
			return builder.network((network) =>
				network.policy(mod.NetworkPolicy?.none() ?? { defaultEgress: 'deny', defaultIngress: 'deny', rules: [] }),
			)
		case 'allow-list':
			return builder.network((network) =>
				network.policy({
					defaultEgress: 'deny',
					defaultIngress: 'allow',
					rules: [
						...policy.subnets.deny.map((subnet) => microsandboxSubnetRule(mod, 'deny', subnet)),
						...policy.hosts.map((host) => microsandboxHostRule(mod, host)),
						...policy.subnets.allow.map((subnet) => microsandboxSubnetRule(mod, 'allow', subnet)),
					],
				}),
			)
		default:
			throw new Error(`Unexpected sandbox network policy: ${String(policy satisfies never)}`)
	}
}

function microsandboxHostRule(mod: MicrosandboxModule, host: string): unknown {
	return (
		mod.Rule?.allowEgress(mod.Destination?.domain(host) ?? { type: 'domain', value: host }) ?? {
			action: 'allow-egress',
			destination: { type: 'domain', value: host },
		}
	)
}

function microsandboxSubnetRule(mod: MicrosandboxModule, action: 'allow' | 'deny', subnet: string): unknown {
	const destination = mod.Destination?.cidr?.(subnet) ?? mod.Destination?.subnet?.(subnet) ?? { type: 'cidr', value: subnet }
	return action === 'allow'
		? (mod.Rule?.allowEgress(destination) ?? { action: 'allow-egress', destination })
		: (mod.Rule?.denyEgress(destination) ?? { action: 'deny-egress', destination })
}

function isMicrosandboxNotFoundError(error: unknown): boolean {
	return error instanceof Error && /not[ -]?found|no such sandbox|does not exist/i.test(error.message)
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === 'string')
	)
}

function isEnvName(value: string): boolean {
	return /^[A-Z_][A-Z0-9_]*$/.test(value)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Microsandbox sandbox runtime', () => {
		it('creates detached OCI sandboxes with resources and network policy', async () => {
			const sdk = fakeMicrosandboxSdk()
			const runtime = createMicrosandboxSandboxRuntime({ coreStorageNamespace: 'portfolios/test', microsandbox: sdk })

			const sandbox = await runtime.create({
				key: 'agent-run-1',
				config: {
					source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
					resources: { vcpus: 3 },
					networkPolicy: {
						type: 'allow-list',
						hosts: ['registry.npmjs.org'],
						subnets: { allow: ['10.0.0.0/8'], deny: ['10.1.0.0/16'] },
					},
				},
			})

			expect(sandbox.key).toBe('agent-run-1')
			expect(sdk.created[0]).toMatchObject({
				image: 'alpine:latest',
				cpus: 3,
				memory: 6144,
				detached: true,
				replace: true,
				patches: ['/workspace', '/.gorchestra'],
			})
			expect(sdk.created[0]?.network).toMatchObject({ defaultEgress: 'deny', defaultIngress: 'allow' })
		})

		it('intercepts runtime env commands and redacts prepared and command env output', async () => {
			const sdk = fakeMicrosandboxSdk()
			const runtime = createMicrosandboxSandboxRuntime({ coreStorageNamespace: 'portfolio-1', microsandbox: sdk })
			const sandbox = await runtime.create({
				key: 'agent-run-1',
				config: {
					source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
					resources: { vcpus: 2 },
					networkPolicy: { type: 'allow-all' },
				},
			})

			await expect(
				sandbox.runCommand({
					label: 'Set env',
					command: { executable: 'gorchestra-env', args: ['set', 'NPM_TOKEN'], cwd: null },
					commandSecretEnv: { GORCHESTRA_SECRET_VALUE: 'prepared-secret' },
					timeoutMs: 1_000,
				}),
			).resolves.toEqual({ exitCode: 0, summary: 'Environment variable set.', stdout: null, stderr: null })

			await expect(
				sandbox.runCommand({
					label: 'Read env',
					command: { executable: 'printenv', args: ['NPM_TOKEN'], cwd: null },
					commandSecretEnv: { EXTRA_TOKEN: 'command-secret' },
					timeoutMs: 1_000,
				}),
			).resolves.toEqual({
				exitCode: 0,
				summary: 'Command completed.',
				stdout: 'prepared=[REDACTED] command=[REDACTED]',
				stderr: null,
			})
			expect(sdk.runningSandboxes[0]?.execs[0]).toMatchObject({
				command: 'printenv',
				args: ['NPM_TOKEN'],
				cwd: '/workspace',
				env: { NPM_TOKEN: 'prepared-secret', EXTRA_TOKEN: 'command-secret' },
				timeout: 1_000,
			})
		})

		it('finds, releases, and removes existing sandboxes by namespaced key', async () => {
			const sdk = fakeMicrosandboxSdk()
			const runtime = createMicrosandboxSandboxRuntime({ coreStorageNamespace: 'portfolio-1', microsandbox: sdk })
			await runtime.create({
				key: 'agent-run-1',
				config: {
					source: { type: 'consumer-managed', ociImage: 'alpine' },
					resources: { vcpus: 1 },
					networkPolicy: { type: 'allow-all' },
				},
			})

			const sandbox = await runtime.find({ key: 'agent-run-1' })
			await expect(sandbox?.release()).resolves.toEqual({ summary: 'Sandbox released.' })

			expect(sandbox?.key).toBe('agent-run-1')
			expect(sdk.removed).toEqual([sdk.created[0]?.name])
			expect(sdk.runningSandboxes[0]?.stopped).toBe(true)
		})
	})

	function fakeMicrosandboxSdk() {
		const sandboxes = new Map<string, FakeRunningSandbox>()
		return {
			created: [] as Array<Record<string, unknown>>,
			runningSandboxes: [] as FakeRunningSandbox[],
			removed: [] as string[],
			create({ name, config }: { name: string; config: ConsumerManagedSandboxConfig }) {
				const sandbox = new FakeRunningSandbox()
				sandboxes.set(name, sandbox)
				this.runningSandboxes.push(sandbox)
				this.created.push({
					name,
					image: config.source.ociImage,
					cpus: config.resources.vcpus,
					memory: sandboxMemoryMiBForVcpus(config.resources.vcpus),
					detached: true,
					replace: true,
					patches: [workspacePath, runtimeEnvDirPath],
					network:
						config.networkPolicy.type === 'allow-list'
							? { defaultEgress: 'deny', defaultIngress: 'allow' }
							: config.networkPolicy.type,
				})
				return Promise.resolve(sandbox)
			},
			find({ name }: { name: string }) {
				return Promise.resolve(sandboxes.get(name) ?? null)
			},
			remove({ name }: { name: string }) {
				this.removed.push(name)
				sandboxes.delete(name)
				return Promise.resolve()
			},
		} satisfies MicrosandboxSdk & { created: Array<Record<string, unknown>>; runningSandboxes: FakeRunningSandbox[]; removed: string[] }
	}

	class FakeRunningSandbox implements MicrosandboxRunningSandbox {
		readonly files = new Map<string, string>()
		readonly execs: Array<Record<string, unknown>> = []
		stopped = false

		execWith(
			command: string,
			configure: (builder: MicrosandboxExecOptionsBuilder) => MicrosandboxExecOptionsBuilder,
		): Promise<MicrosandboxExecOutput> {
			const exec = new FakeExecOptionsBuilder()
			configure(exec)
			this.execs.push({ command, args: exec.commandArgs, cwd: exec.commandCwd, env: exec.commandEnv, timeout: exec.commandTimeout })
			return Promise.resolve({
				code: 0,
				stdout: () => `prepared=${exec.commandEnv.NPM_TOKEN} command=${exec.commandEnv.EXTRA_TOKEN}`,
				stderr: () => '',
			})
		}

		fs(): MicrosandboxFs {
			return {
				exists: (path) => Promise.resolve(path === runtimeEnvDirPath || this.files.has(path)),
				mkdir: () => Promise.resolve(),
				readToString: (path) => Promise.resolve(this.files.get(path) ?? '{}'),
				write: (path, data) => {
					this.files.set(path, data)
					return Promise.resolve()
				},
			}
		}

		stop(): Promise<void> {
			this.stopped = true
			return Promise.resolve()
		}
	}

	class FakeExecOptionsBuilder implements MicrosandboxExecOptionsBuilder {
		commandArgs: string[] = []
		commandCwd = ''
		commandEnv: Record<string, string> = {}
		commandTimeout = 0

		args(args: string[]): MicrosandboxExecOptionsBuilder {
			this.commandArgs = args
			return this
		}

		cwd(cwd: string): MicrosandboxExecOptionsBuilder {
			this.commandCwd = cwd
			return this
		}

		envs(env: Record<string, string>): MicrosandboxExecOptionsBuilder {
			this.commandEnv = env
			return this
		}

		timeout(timeoutMs: number): MicrosandboxExecOptionsBuilder {
			this.commandTimeout = timeoutMs
			return this
		}
	}
}
