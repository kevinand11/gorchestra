import type { CoreServices, CoreStorage } from '@gorchestra/core'

import { createMicrosandboxSandboxRuntime } from './sandbox'
import { revealSecretPlaintext, type SecretEncryptionKey } from '../modules/secret-protection'

export type CreateCoreServicesOptions = {
	secretEncryptionKey: SecretEncryptionKey
	dispatcher: CoreServices['dispatcher']
	sandboxRootDir: string
	coreStorageNamespace: string
}

export function createCoreServices(storage: CoreStorage, options: CreateCoreServicesOptions): CoreServices {
	return {
		storage,
		secrets: {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues: ({ secrets }) => Promise.resolve(resolveSecretValues(secrets, options.secretEncryptionKey)),
		},
		sandbox: createMicrosandboxSandboxRuntime({
			coreStorageNamespace: options.coreStorageNamespace,
		}),
		dispatcher: options.dispatcher,
	}
}

function resolveSecretValues(
	secrets: Parameters<CoreServices['secrets']['resolveSecretValues']>[0]['secrets'],
	secretEncryptionKey: SecretEncryptionKey,
): Awaited<ReturnType<CoreServices['secrets']['resolveSecretValues']>> {
	return Object.fromEntries(
		secrets.flatMap((secret) => {
			const plaintext = revealSecretPlaintext(secret.valueRef, secretEncryptionKey)
			return plaintext === null ? [] : [[secret.secretId, plaintext]]
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Core services', () => {
		it('resolves inline protected Secret value refs and wires consumer-managed sandbox runtime', async () => {
			const { mkdtemp, rm } = await import('node:fs/promises')
			const { tmpdir } = await import('node:os')
			const { join } = await import('node:path')
			const { parseSecretEncryptionKey, protectSecretPlaintext } = await import('../modules/secret-protection')
			const sandboxRootDir = await mkdtemp(join(tmpdir(), 'gorchestra-core-services-'))
			const secretEncryptionKey = parseSecretEncryptionKey(Buffer.alloc(32, 1).toString('base64url'))
			const valueRef = protectSecretPlaintext('token-value', secretEncryptionKey)
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => Promise.resolve('dispatch-marker'),
				ready: () => {},
			}
			const services = createCoreServices({} as CoreStorage, {
				secretEncryptionKey,
				dispatcher,
				sandboxRootDir,
				coreStorageNamespace: 'portfolio-1',
			})

			try {
				expect(await services.secrets.preflight()).toEqual({ ok: true })
				expect(await services.secrets.resolveSecrets({ scope: { type: 'project', projectId: 'project-1' } })).toEqual([])
				expect(await services.secrets.resolveSecretValues({ secrets: [{ secretId: 'secret-1', valueRef }] })).toEqual({
					'secret-1': 'token-value',
				})
				expect(await services.secrets.resolveSecretValues({ secrets: [{ secretId: 'secret-2', valueRef: 'bad-ref' }] })).toEqual({})
				expect(services.sandbox.kind).toBe('consumer-managed')
				expect(typeof services.sandbox.create).toBe('function')
				expect(typeof services.sandbox.find).toBe('function')
			} finally {
				await rm(sandboxRootDir, { recursive: true, force: true })
			}
		})
	})
}
