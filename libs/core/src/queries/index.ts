import type { CoreRuntime } from '../runtime'
import { createGetProjectQuery } from './get-project'
import { createGetRepositoryQuery } from './get-repository'
import { createGetSecretQuery } from './get-secret'
import { createListProjectsQuery } from './list-projects'
import { createListRepositoriesQuery } from './list-repositories'
import { createListSecretReferencesQuery } from './list-secret-references'
import { createListSecretsQuery } from './list-secrets'

export type * as GetProject from './get-project'
export type * as GetRepository from './get-repository'
export type * as GetSecret from './get-secret'
export type * as ListProjects from './list-projects'
export type * as ListRepositories from './list-repositories'
export type * as ListSecretReferences from './list-secret-references'
export type * as ListSecrets from './list-secrets'

export function createCoreQueries(runtime: CoreRuntime) {
	const services = runtime.services

	return {
		listProjects: createListProjectsQuery(services),
		getProject: createGetProjectQuery(services),
		listRepositories: createListRepositoriesQuery(services),
		getRepository: createGetRepositoryQuery(services),
		listSecrets: createListSecretsQuery(services),
		getSecret: createGetSecretQuery(services),
		listSecretReferences: createListSecretReferencesQuery(services),
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
			const queryNames = [
				'getProject',
				'getRepository',
				'getSecret',
				'listProjects',
				'listRepositories',
				'listSecretReferences',
				'listSecrets',
			]

			expect(Object.keys(queries).sort()).toEqual([...queryNames].sort())
			for (const queryName of queryNames) {
				expect(typeof queries[queryName]).toBe('function')
			}
		})
	})
}
