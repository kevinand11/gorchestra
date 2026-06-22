import type { CoreServices, CoreStorage } from '@gorchestra/core'

import { revealSecretPlaintext, type SecretEncryptionKey } from '../modules/secret-protection'

export type CreateCoreServicesOptions = {
	secretEncryptionKey: SecretEncryptionKey
}

export function createCoreServices(storage: CoreStorage, options: CreateCoreServicesOptions): CoreServices {
	return {
		storage,
		secrets: {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues: ({ secrets }) => Promise.resolve(resolveSecretValues(secrets, options.secretEncryptionKey)),
		},
		sandbox: { preflight: () => Promise.resolve({ ok: true }) },
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
		it('preflights and resolves inline protected Secret value refs', async () => {
			const { parseSecretEncryptionKey, protectSecretPlaintext } = await import('../modules/secret-protection')
			const secretEncryptionKey = parseSecretEncryptionKey(Buffer.alloc(32, 1).toString('base64url'))
			const valueRef = protectSecretPlaintext('token-value', secretEncryptionKey)
			const services = createCoreServices({} as CoreStorage, { secretEncryptionKey })

			expect(await services.secrets.preflight()).toEqual({ ok: true })
			expect(await services.secrets.resolveSecrets({ scope: { type: 'project', projectId: 'project-1' } })).toEqual([])
			expect(await services.secrets.resolveSecretValues({ secrets: [{ secretId: 'secret-1', valueRef }] })).toEqual({
				'secret-1': 'token-value',
			})
			expect(await services.secrets.resolveSecretValues({ secrets: [{ secretId: 'secret-2', valueRef: 'bad-ref' }] })).toEqual({})
			expect(await services.sandbox.preflight()).toEqual({ ok: true })
		})
	})
}
