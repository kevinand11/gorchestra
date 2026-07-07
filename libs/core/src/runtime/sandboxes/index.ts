import type { CoreRuntime } from '..'
import { manageSandboxProvider, type ManagedSandboxProvider } from './managed'
import { createVercelSandboxProvider, type VercelCredentials } from './vercel'
import type { AgentRunSandboxConfig, VercelSandboxCredentialsSecretRefs } from '../../domain/agent-run-runtime'
import type {
	InvalidCoreServiceOutputError,
	ResourceNotFoundError,
	SecretNotActiveError,
	SecretResolutionFailedError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreStorage } from '../../services'
import { resolveActiveSecretValues } from '../../utils/secret-values'
import type { Result } from '../../utils/types'

export type SandboxProviderResolutionError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| { type: 'sandbox-provider-resolution-failed'; summary: string }

export async function managedSandboxProviderForConfig(
	runtime: Pick<CoreRuntime, 'services'>,
	storage: CoreStorage,
	config: AgentRunSandboxConfig,
): Promise<Result<ManagedSandboxProvider, SandboxProviderResolutionError>> {
	const options = runtime.services.logger === undefined ? {} : { logger: runtime.services.logger }
	switch (config.source.type) {
		case 'consumer-managed':
			return { ok: true, value: manageSandboxProvider(runtime.services.sandbox, options) }
		case 'vercel-runtime':
		case 'vercel-vcr-image': {
			const credentials = await resolveVercelCredentials(runtime, storage, config.source.credentials)
			return credentials.ok
				? {
						ok: true,
						value: manageSandboxProvider(
							createVercelSandboxProvider({ source: config.source, credentials: credentials.value }),
							options,
						),
					}
				: credentials
		}
		default:
			throw new Error(`Unexpected Agent Run Sandbox source type: ${String(config.source satisfies never)}`)
	}
}

async function resolveVercelCredentials(
	runtime: Pick<CoreRuntime, 'services'>,
	storage: CoreStorage,
	credentials: VercelSandboxCredentialsSecretRefs,
): Promise<Result<VercelCredentials, SandboxProviderResolutionError>> {
	const values = await resolveActiveSecretValues(runtime.services, storage, [
		credentials.tokenSecretId,
		credentials.teamIdSecretId,
		credentials.projectIdSecretId,
	])
	if (!values.ok) return values

	const token = vercelCredentialValue(values.value, credentials.tokenSecretId, 'token')
	if (!token.ok) return token
	const teamId = vercelCredentialValue(values.value, credentials.teamIdSecretId, 'team id')
	if (!teamId.ok) return teamId
	const projectId = vercelCredentialValue(values.value, credentials.projectIdSecretId, 'project id')
	return projectId.ok ? { ok: true, value: { token: token.value, teamId: teamId.value, projectId: projectId.value } } : projectId
}

function vercelCredentialValue(
	values: Record<string, Result<string, ResourceNotFoundError | SecretNotActiveError | SecretResolutionFailedError>>,
	secretId: string,
	name: 'token' | 'team id' | 'project id',
): Result<string, { type: 'sandbox-provider-resolution-failed'; summary: string }> {
	const value = values[secretId]
	if (value === undefined) return failedVercelCredentialResolution(name)
	if (value.ok) return { ok: true, value: value.value }

	switch (value.error.type) {
		case 'not-found':
			return {
				ok: false,
				error: { type: 'sandbox-provider-resolution-failed', summary: `Vercel sandbox ${name} Secret is missing.` },
			}
		case 'secret-not-active':
			return {
				ok: false,
				error: { type: 'sandbox-provider-resolution-failed', summary: `Vercel sandbox ${name} Secret is not active.` },
			}
		case 'secret-resolution-failed':
			return failedVercelCredentialResolution(name)
		default:
			throw new Error(`Unexpected Vercel credential resolution error: ${String(value.error satisfies never)}`)
	}
}

function failedVercelCredentialResolution(
	name: 'token' | 'team id' | 'project id',
): Result<never, { type: 'sandbox-provider-resolution-failed'; summary: string }> {
	return { ok: false, error: { type: 'sandbox-provider-resolution-failed', summary: `Vercel sandbox ${name} Secret resolution failed.` } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedSecret } = await import('../../utils/test-helpers')

	describe('managedSandboxProviderForConfig', () => {
		it('wraps the consumer-managed raw Sandbox Provider', async () => {
			const services = createTestCoreServices()
			const result = await managedSandboxProviderForConfig(createTestCoreRuntime(services), services.storage, {
				source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			})

			expect(result).toMatchObject({ ok: true, value: { kind: 'consumer-managed' } })
			if (!result.ok) return
			const sandbox = await result.value.create({
				key: 'agent-run-key',
				config: {
					source: { type: 'consumer-managed', ociImage: 'alpine:latest' },
					resources: { vcpus: 2 },
					networkPolicy: { type: 'allow-all' },
				},
			})
			expect(sandbox).toMatchObject({ ok: true })
		})

		it('resolves Vercel credential Secrets before constructing a Vercel provider', async () => {
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

			const result = await managedSandboxProviderForConfig(createTestCoreRuntime(services), services.storage, {
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
			})

			expect(result).toMatchObject({ ok: true, value: { kind: 'vercel-runtime' } })
		})

		it('maps inactive Vercel credential Secrets to provider resolution evidence summaries', async () => {
			const services = createTestCoreServices()
			seedSecret(services.tx, '01k00000000000000000000040', true)

			const result = await managedSandboxProviderForConfig(createTestCoreRuntime(services), services.storage, {
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
			})

			expect(result).toEqual({
				ok: false,
				error: { type: 'sandbox-provider-resolution-failed', summary: 'Vercel sandbox token Secret is not active.' },
			})
		})
	})
}
