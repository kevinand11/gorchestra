import type { CoreServices, CoreStorage } from '@gorchestra/core'

export function createCoreServices(storage: CoreStorage): CoreServices {
	return {
		storage,
		secrets: {
			preflight: () => Promise.resolve({ ok: true }),
			resolveSecrets: () => Promise.resolve([]),
			resolveSecretValues: () => Promise.resolve({}),
		},
		sandbox: { preflight: () => Promise.resolve({ ok: true }) },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server Core services', () => {
		it('preflights without requiring Secret vault configuration', async () => {
			const services = createCoreServices({} as CoreStorage)

			expect(await services.secrets.preflight()).toEqual({ ok: true })
			expect(await services.secrets.resolveSecrets({ scope: { type: 'project', projectId: 'project-1' } })).toEqual([])
			expect(await services.secrets.resolveSecretValues({ secretIds: ['secret-1'] })).toEqual({})
			expect(await services.sandbox.preflight()).toEqual({ ok: true })
		})
	})
}
