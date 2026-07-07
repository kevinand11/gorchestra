import type {
	AgentRunSandboxConfig,
	AgentRunSandboxNetworkPolicy,
	AgentRunSandboxSourceConfig,
	VercelSandboxCredentialsSecretRefs,
} from '../../domain/agent-run-runtime'
import type { Secret } from '../../domain/secret'
import type { InvalidCoreServiceOutputError, ResourceNotFoundError, SecretNotActiveError, StorageOperationFailedError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import {
	resolvedSecretValuesPipe,
	type AgentRunSandboxConfigForSource,
	type ResolvableSecretValue,
	type Sandbox,
	type SandboxCommandOutput,
	type SandboxRuntime,
	type SandboxRunCommandInput,
	type SandboxReleaseOutput,
	type CoreStorage,
} from '../../services'
import { getRequired } from '../../storage/helpers'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

const runtimeEnvFilePath = '/vercel/sandbox/.gorchestra/runtime-env.json'
const runtimeEnvDirPath = '/vercel/sandbox/.gorchestra'
const commandOutputLimitBytes = 16 * 1024

export const sandboxSmokeCommand = {
	executable: 'true',
	args: [],
	cwd: '/workspace',
} as const

export type SandboxRuntimeResolutionError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| SecretNotActiveError
	| StorageOperationFailedError
	| { type: 'sandbox-runtime-resolution-failed'; summary: string }

export interface SandboxRuntimeResolverOptions {
	vercelSdk?: VercelSandboxSdk
}

interface VercelCredentials {
	token: string
	teamId: string
	projectId: string
}

interface VercelSandboxSdk {
	getOrCreate(input: Record<string, unknown>): Promise<VercelSandboxHandle>
	get(input: Record<string, unknown>): Promise<VercelSandboxHandle>
	isNotFoundError(error: unknown): boolean
}

interface VercelSandboxHandle {
	runCommand(input: Record<string, unknown>): Promise<VercelCommandFinished>
	delete(): Promise<void>
	fs: VercelFileSystem
}

interface VercelCommandFinished {
	exitCode: number
	stdout(): Promise<string>
	stderr(): Promise<string>
}

interface VercelFileSystem {
	mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>
	readFile(path: string, encoding: 'utf8'): Promise<string>
	writeFile(path: string, data: string, encoding: 'utf8'): Promise<unknown>
}

interface VercelSandboxRuntimeInput {
	source: Extract<AgentRunSandboxSourceConfig, { type: 'vercel-runtime' | 'vercel-vcr-image' }>
	credentials: VercelCredentials
	vercelSdk: VercelSandboxSdk
}

export async function sandboxRuntimeForConfig(
	runtime: Pick<CoreRuntime, 'services'>,
	storage: CoreStorage,
	config: AgentRunSandboxConfig,
	options: SandboxRuntimeResolverOptions = {},
): Promise<Result<SandboxRuntime, SandboxRuntimeResolutionError>> {
	switch (config.source.type) {
		case 'consumer-managed':
			return { ok: true, value: runtime.services.sandbox }
		case 'vercel-runtime':
		case 'vercel-vcr-image': {
			const credentials = await resolveVercelCredentials(runtime, storage, config.source.credentials)
			if (!credentials.ok) return credentials

			return {
				ok: true,
				value: createVercelSandboxRuntime({
					source: config.source,
					credentials: credentials.value,
					vercelSdk: options.vercelSdk ?? (await defaultVercelSandboxSdk()),
				}),
			}
		}
		default:
			throw new Error(`Unexpected Agent Run Sandbox source type: ${String(config.source satisfies never)}`)
	}
}

async function resolveVercelCredentials(
	runtime: Pick<CoreRuntime, 'services'>,
	storage: CoreStorage,
	credentials: VercelSandboxCredentialsSecretRefs,
): Promise<Result<VercelCredentials, SandboxRuntimeResolutionError>> {
	const tokenSecret = await loadActiveSecret(storage, credentials.tokenSecretId)
	if (!tokenSecret.ok) return tokenSecret

	const teamIdSecret = await loadActiveSecret(storage, credentials.teamIdSecretId)
	if (!teamIdSecret.ok) return teamIdSecret

	const projectIdSecret = await loadActiveSecret(storage, credentials.projectIdSecretId)
	if (!projectIdSecret.ok) return projectIdSecret

	const secretValues = await runtime.services.secrets.resolveSecretValues({
		secrets: uniqueSecrets([tokenSecret.value, teamIdSecret.value, projectIdSecret.value].map(secretValueRef)),
	})
	const validated = validateCoreServiceOutput(resolvedSecretValuesPipe, secretValues, 'secrets', 'resolveSecretValues')
	if (!validated.ok) return validated

	const resolved = validated.value
	const token = resolved[credentials.tokenSecretId]
	if (token === undefined || token.length === 0) return failedResolution('Vercel token Secret resolved to an empty value.')

	const teamId = resolved[credentials.teamIdSecretId]
	if (teamId === undefined || teamId.length === 0) return failedResolution('Vercel team id Secret resolved to an empty value.')

	const projectId = resolved[credentials.projectIdSecretId]
	if (projectId === undefined || projectId.length === 0) return failedResolution('Vercel project id Secret resolved to an empty value.')

	return { ok: true, value: { token, teamId, projectId } }
}

async function loadActiveSecret(
	storage: CoreStorage,
	secretId: string,
): Promise<Result<Secret, ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	const secret = await getRequired('secret', storage, secretId)
	if (!secret.ok) return secret
	if (isArchived(secret.value)) return { ok: false, error: { type: 'secret-not-active', secretId } }
	return secret
}

function createVercelSandboxRuntime(input: VercelSandboxRuntimeInput): SandboxRuntime<typeof input.source> {
	return {
		kind: input.source.type,
		create: async ({ key, config }) =>
			vercelSandbox(
				key,
				await input.vercelSdk.getOrCreate({
					...vercelCreateParams(key, config, input.credentials),
					onCreate: ensureVercelWorkspaceSymlink,
					onResume: ensureVercelWorkspaceSymlink,
				}),
			),
		find: async ({ key }) => {
			try {
				return vercelSandbox(
					key,
					await input.vercelSdk.get({
						...input.credentials,
						name: key,
						resume: true,
						onResume: ensureVercelWorkspaceSymlink,
					}),
				)
			} catch (error) {
				if (input.vercelSdk.isNotFoundError(error)) return null
				throw error
			}
		},
	}
}

function vercelCreateParams(
	key: string,
	config: AgentRunSandboxConfigForSource<Extract<AgentRunSandboxSourceConfig, { type: 'vercel-runtime' | 'vercel-vcr-image' }>>,
	credentials: VercelCredentials,
): Record<string, unknown> {
	const sourceParams = vercelSourceParams(config.source)
	return {
		...credentials,
		...sourceParams,
		name: key,
		persistent: true,
		resources: { vcpus: config.resources.vcpus },
		networkPolicy: vercelNetworkPolicy(config.networkPolicy),
	}
}

function vercelSourceParams(
	source: Extract<AgentRunSandboxSourceConfig, { type: 'vercel-runtime' | 'vercel-vcr-image' }>,
): Record<string, unknown> {
	switch (source.type) {
		case 'vercel-runtime':
			return { runtime: source.runtime }
		case 'vercel-vcr-image':
			return { image: source.vcrImage }
		default:
			throw new Error(`Unexpected Vercel sandbox source type: ${String(source satisfies never)}`)
	}
}

function vercelNetworkPolicy(policy: AgentRunSandboxNetworkPolicy): unknown {
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

function vercelSandbox(key: string, handle: VercelSandboxHandle): Sandbox {
	return {
		key,
		runCommand: (input) => runVercelCommand(handle, input),
		release: () => releaseVercelSandbox(handle),
	}
}

async function runVercelCommand(handle: VercelSandboxHandle, input: SandboxRunCommandInput): Promise<SandboxCommandOutput> {
	try {
		if (isRuntimeEnvSetCommand(input)) return storeRuntimeEnv(handle, input)

		const runtimeEnv = await loadRuntimeEnv(handle)
		if (!runtimeEnv.ok) return runtimeEnv.error

		const env = { ...runtimeEnv.value, ...input.commandSecretEnv }
		const result = await handle.runCommand({
			cmd: input.command.executable,
			args: input.command.args,
			cwd: input.command.cwd ?? '/workspace',
			env,
			timeoutMs: input.timeoutMs,
		})
		const secrets = Object.values(env).filter((value) => value.length > 0)
		return commandOutput(result.exitCode, 'Sandbox command completed.', await result.stdout(), await result.stderr(), secrets)
	} catch {
		return failedCommandOutput('Sandbox command execution failed.')
	}
}

async function storeRuntimeEnv(handle: VercelSandboxHandle, input: SandboxRunCommandInput): Promise<SandboxCommandOutput> {
	const envName = input.command.args[1]
	const value = input.commandSecretEnv.GORCHESTRA_SECRET_VALUE
	if (envName === undefined || envName.length === 0 || value === undefined)
		return failedCommandOutput('Invalid runtime environment command.')

	const existing = await loadRuntimeEnv(handle)
	if (!existing.ok) return existing.error

	await writeRuntimeEnv(handle, { ...existing.value, [envName]: value })
	return { exitCode: 0, summary: 'Runtime environment value stored.', stdout: null, stderr: null }
}

function isRuntimeEnvSetCommand(input: SandboxRunCommandInput): boolean {
	return input.command.executable === 'gorchestra-env' && input.command.args[0] === 'set'
}

async function loadRuntimeEnv(handle: VercelSandboxHandle): Promise<Result<Record<string, string>, SandboxCommandOutput>> {
	try {
		const content = await handle.fs.readFile(runtimeEnvFilePath, 'utf8')
		const parsed = JSON.parse(content) as unknown
		return isStringRecord(parsed)
			? { ok: true, value: parsed }
			: { ok: false, error: failedCommandOutput('Sandbox runtime environment store is invalid.') }
	} catch (error) {
		if (isFileNotFoundError(error)) return { ok: true, value: {} }
		throw error
	}
}

async function writeRuntimeEnv(handle: VercelSandboxHandle, env: Record<string, string>): Promise<void> {
	await handle.fs.mkdir(runtimeEnvDirPath, { recursive: true })
	await handle.fs.writeFile(runtimeEnvFilePath, JSON.stringify(env), 'utf8')
}

async function releaseVercelSandbox(handle: VercelSandboxHandle): Promise<SandboxReleaseOutput> {
	await handle.delete()
	return { summary: 'Sandbox released.' }
}

async function ensureVercelWorkspaceSymlink(handle: VercelSandboxHandle): Promise<void> {
	const mkdir = await handle.runCommand({ cmd: 'mkdir', args: ['-p', '/vercel/sandbox'], sudo: true })
	if (mkdir.exitCode !== 0) throw new Error('Failed to create Vercel sandbox workspace directory.')

	const link = await handle.runCommand({
		cmd: 'sh',
		args: ['-lc', 'rm -rf /workspace && ln -s /vercel/sandbox /workspace'],
		sudo: true,
	})
	if (link.exitCode !== 0) throw new Error('Failed to create Vercel sandbox workspace symlink.')
}

async function defaultVercelSandboxSdk(): Promise<VercelSandboxSdk> {
	const mod = (await import('@vercel/sandbox')) as {
		Sandbox: {
			getOrCreate(input: Record<string, unknown>): Promise<VercelSandboxHandle>
			get(input: Record<string, unknown>): Promise<VercelSandboxHandle>
		}
		APIError?: new (...args: never[]) => Error
	}

	return {
		getOrCreate: (input) => mod.Sandbox.getOrCreate(input),
		get: (input) => mod.Sandbox.get(input),
		isNotFoundError: (error) => mod.APIError !== undefined && error instanceof mod.APIError && errorStatus(error) === 404,
	}
}

function commandOutput(exitCode: number, summary: string, stdout: string, stderr: string, secrets: string[]): SandboxCommandOutput {
	return {
		exitCode,
		summary,
		stdout: normalizedStream(stdout, secrets),
		stderr: normalizedStream(stderr, secrets),
	}
}

function failedCommandOutput(summary: string): SandboxCommandOutput {
	return { exitCode: 1, summary, stdout: null, stderr: null }
}

function normalizedStream(value: string, secrets: string[]): string | null {
	const redacted = redactSecrets(value, secrets)
	const truncated = truncateUtf8(redacted, commandOutputLimitBytes)
	return truncated.length === 0 ? null : truncated
}

function redactSecrets(value: string, secrets: string[]): string {
	return secrets.reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), value)
}

function truncateUtf8(value: string, maxBytes: number): string {
	const bytes = Buffer.from(value)
	return bytes.byteLength <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8')
}

function failedResolution(summary: string): Result<never, SandboxRuntimeResolutionError> {
	return { ok: false, error: { type: 'sandbox-runtime-resolution-failed', summary } }
}

function isArchived(record: { archivePeriods: Array<{ unarchived: object | null }> }): boolean {
	return record.archivePeriods.at(-1)?.unarchived === null
}

function secretValueRef(secret: Pick<Secret, 'id' | 'valueRef'>): ResolvableSecretValue {
	return { secretId: secret.id, valueRef: secret.valueRef }
}

function uniqueSecrets(secrets: ResolvableSecretValue[]): ResolvableSecretValue[] {
	return [...new Map(secrets.map((secret) => [secret.secretId, secret])).values()]
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((recordValue) => typeof recordValue === 'string')
	)
}

function isFileNotFoundError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function errorStatus(error: unknown): number | null {
	return typeof error === 'object' &&
		error !== null &&
		typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
		? (error as { response: { status: number } }).response.status
		: null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedSecret } = await import('../../utils/test-helpers')

	describe('sandboxRuntimeForConfig', () => {
		it('returns the consumer-managed Sandbox Runtime for consumer-managed configs', async () => {
			const services = createTestCoreServices()
			const runtime = createTestCoreRuntime(services)

			const result = await sandboxRuntimeForConfig(runtime, services.storage, {
				source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			})

			expect(result).toEqual({ ok: true, value: services.sandbox })
		})

		it('resolves Vercel credential Secrets before creating a Vercel runtime', async () => {
			const services = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: (input) =>
						Promise.resolve(
							Object.fromEntries(input.secrets.map((secret) => [secret.secretId, `value-${secret.secretId.slice(-2)}`])),
						),
				},
			})
			seedSecret(services.tx, '01k00000000000000000000040')
			seedSecret(services.tx, '01k00000000000000000000041')
			seedSecret(services.tx, '01k00000000000000000000042')
			const sdk = fakeVercelSdk()

			const result = await sandboxRuntimeForConfig(
				createTestCoreRuntime(services),
				services.storage,
				{
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
					networkPolicy: {
						type: 'allow-list',
						hosts: ['registry.npmjs.org'],
						subnets: { allow: ['10.0.0.0/8'], deny: ['10.1.0.0/16'] },
					},
				},
				{ vercelSdk: sdk },
			)
			expect(result).toMatchObject({ ok: true, value: { kind: 'vercel-runtime' } })
			if (!result.ok) return

			await result.value.create({
				key: 'agent-run-key',
				config: {
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
					networkPolicy: {
						type: 'allow-list',
						hosts: ['registry.npmjs.org'],
						subnets: { allow: ['10.0.0.0/8'], deny: ['10.1.0.0/16'] },
					},
				},
			})

			expect(sdk.calls.getOrCreate[0]).toMatchObject({
				name: 'agent-run-key',
				runtime: 'node24',
				token: 'value-40',
				teamId: 'value-41',
				projectId: 'value-42',
				resources: { vcpus: 2 },
				networkPolicy: { allow: ['registry.npmjs.org'], subnets: { allow: ['10.0.0.0/8'], deny: ['10.1.0.0/16'] } },
			})
		})

		it('returns a resolution failure when a Vercel credential Secret resolves empty', async () => {
			const services = createTestCoreServices({
				secrets: {
					preflight: () => Promise.resolve({ ok: true }),
					resolveSecrets: () => Promise.resolve([]),
					resolveSecretValues: () =>
						Promise.resolve({
							'01k00000000000000000000040': 'token',
							'01k00000000000000000000041': '',
							'01k00000000000000000000042': 'project',
						}),
				},
			})
			seedSecret(services.tx, '01k00000000000000000000040')
			seedSecret(services.tx, '01k00000000000000000000041')
			seedSecret(services.tx, '01k00000000000000000000042')

			const result = await sandboxRuntimeForConfig(
				createTestCoreRuntime(services),
				services.storage,
				{
					source: {
						type: 'vercel-vcr-image',
						vcrImage: 'sandbox-image:latest',
						credentials: {
							tokenSecretId: '01k00000000000000000000040',
							teamIdSecretId: '01k00000000000000000000041',
							projectIdSecretId: '01k00000000000000000000042',
						},
					},
					resources: { vcpus: 2 },
					networkPolicy: { type: 'allow-all' },
				},
				{ vercelSdk: fakeVercelSdk() },
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'sandbox-runtime-resolution-failed', summary: 'Vercel team id Secret resolved to an empty value.' },
			})
		})

		it('returns null when Vercel find sees a not-found API error', async () => {
			const services = createVercelReadyServices()
			const sdk = fakeVercelSdk({ getError: new FakeNotFoundError() })
			const result = await sandboxRuntimeForConfig(createTestCoreRuntime(services), services.storage, vercelRuntimeConfig(), {
				vercelSdk: sdk,
			})
			if (!result.ok) throw new Error('Expected Vercel runtime resolution to pass.')

			await expect(result.value.find({ key: 'missing' })).resolves.toBeNull()
		})

		it('stores runtime env internally and redacts prepared and command Secret values from output', async () => {
			const services = createVercelReadyServices()
			const sdk = fakeVercelSdk()
			const result = await sandboxRuntimeForConfig(createTestCoreRuntime(services), services.storage, vercelRuntimeConfig(), {
				vercelSdk: sdk,
			})
			if (!result.ok) throw new Error('Expected Vercel runtime resolution to pass.')
			const sandbox = await result.value.create({ key: 'agent-run-key', config: vercelRuntimeConfig() })

			await expect(
				sandbox.runCommand({
					label: 'Prepare env',
					command: { executable: 'gorchestra-env', args: ['set', 'NPM_TOKEN'], cwd: null },
					commandSecretEnv: { GORCHESTRA_SECRET_VALUE: 'prepared-secret' },
					timeoutMs: 30_000,
				}),
			).resolves.toEqual({ exitCode: 0, summary: 'Runtime environment value stored.', stdout: null, stderr: null })

			await expect(
				sandbox.runCommand({
					label: 'Echo',
					command: { executable: 'printenv', args: ['NPM_TOKEN'], cwd: null },
					commandSecretEnv: { EXTRA_TOKEN: 'command-secret' },
					timeoutMs: 30_000,
				}),
			).resolves.toEqual({
				exitCode: 0,
				summary: 'Sandbox command completed.',
				stdout: 'prepared=[REDACTED] command=[REDACTED]',
				stderr: null,
			})
		})
	})

	function createVercelReadyServices() {
		const services = createTestCoreServices({
			secrets: {
				preflight: () => Promise.resolve({ ok: true }),
				resolveSecrets: () => Promise.resolve([]),
				resolveSecretValues: () =>
					Promise.resolve({
						'01k00000000000000000000040': 'token',
						'01k00000000000000000000041': 'team',
						'01k00000000000000000000042': 'project',
					}),
			},
		})
		seedSecret(services.tx, '01k00000000000000000000040')
		seedSecret(services.tx, '01k00000000000000000000041')
		seedSecret(services.tx, '01k00000000000000000000042')
		return services
	}

	function vercelRuntimeConfig(): AgentRunSandboxConfigForSource<Extract<AgentRunSandboxSourceConfig, { type: 'vercel-runtime' }>> {
		return {
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
	}

	function fakeVercelSdk(options: { getError?: Error } = {}) {
		const calls: { getOrCreate: Record<string, unknown>[]; get: Record<string, unknown>[] } = { getOrCreate: [], get: [] }
		const handle = fakeVercelHandle()
		return {
			calls,
			getOrCreate: async (input: Record<string, unknown>) => {
				calls.getOrCreate.push(input)
				await (input.onCreate as ((handle: VercelSandboxHandle) => Promise<void>) | undefined)?.(handle)
				return handle
			},
			get: async (input: Record<string, unknown>) => {
				calls.get.push(input)
				if (options.getError !== undefined) throw options.getError
				await (input.onResume as ((handle: VercelSandboxHandle) => Promise<void>) | undefined)?.(handle)
				return handle
			},
			isNotFoundError: (error: unknown) => error instanceof FakeNotFoundError,
		} satisfies VercelSandboxSdk & { calls: typeof calls }
	}

	function fakeVercelHandle(): VercelSandboxHandle {
		const files = new Map<string, string>()
		return {
			fs: {
				mkdir: () => Promise.resolve(),
				readFile: (path) => {
					const content = files.get(path)
					if (content === undefined) {
						const error = new Error('not found') as Error & { code: string }
						error.code = 'ENOENT'
						return Promise.reject(error)
					}
					return Promise.resolve(content)
				},
				writeFile: (path, content) => {
					files.set(path, content)
					return Promise.resolve()
				},
			},
			runCommand: (input) =>
				Promise.resolve({
					exitCode: 0,
					stdout: () =>
						Promise.resolve(
							input.cmd === 'printenv'
								? `prepared=${(input.env as Record<string, string>).NPM_TOKEN} command=${(input.env as Record<string, string>).EXTRA_TOKEN}`
								: '',
						),
					stderr: () => Promise.resolve(''),
				}),
			delete: () => Promise.resolve(),
		}
	}

	class FakeNotFoundError extends Error {}
}
