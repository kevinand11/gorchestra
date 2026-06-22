import type { CoreRuntime } from '../runtime'
import { createGetSecretQuery } from './get-secret'
import { createListProjectsQuery } from './list-projects'
import { createListSecretsQuery } from './list-secrets'

export type * as GetSecret from './get-secret'
export type * as ListProjects from './list-projects'
export type * as ListSecrets from './list-secrets'

export function createCoreQueries(runtime: CoreRuntime) {
	const services = runtime.services

	return {
		listProjects: createListProjectsQuery(services),
		listSecrets: createListSecretsQuery(services),
		getSecret: createGetSecretQuery(services),
	}
}

export type Core = ReturnType<typeof createCoreQueries>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createCoreRuntime } = await import('../runtime')
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('Core queries', () => {
		it('returns an object with the expected query keys', () => {
			const queries = createCoreQueries(createCoreRuntime(createTestCoreServices())) as Record<string, unknown>
			const queryNames = ['getSecret', 'listProjects', 'listSecrets']

			expect(Object.keys(queries).sort()).toEqual([...queryNames].sort())
			for (const queryName of queryNames) {
				expect(typeof queries[queryName]).toBe('function')
			}
		})
	})
}
