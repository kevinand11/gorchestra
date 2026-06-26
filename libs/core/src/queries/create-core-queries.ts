import type { CoreRuntime } from '../runtime'
import { createGetDeliveryQuery } from './get-delivery'
import { createGetMemoryQuery } from './get-memory'
import { createGetPlanQuery } from './get-plan'
import { createGetProjectQuery } from './get-project'
import { createGetRepositoryQuery } from './get-repository'
import { createGetSecretQuery } from './get-secret'
import { createListDeliveriesQuery } from './list-deliveries'
import { createListMemoriesQuery } from './list-memories'
import { createListPlansQuery } from './list-plans'
import { createListProjectsQuery } from './list-projects'
import { createListRepositoriesQuery } from './list-repositories'
import { createListSecretReferencesQuery } from './list-secret-references'
import { createListSecretsQuery } from './list-secrets'

export function createCoreQueries(runtime: CoreRuntime) {
	const services = runtime.services

	return {
		listProjects: createListProjectsQuery(services),
		getProject: createGetProjectQuery(services),
		listPlans: createListPlansQuery(services),
		getPlan: createGetPlanQuery(services),
		listMemories: createListMemoriesQuery(services),
		getMemory: createGetMemoryQuery(services),
		listDeliveries: createListDeliveriesQuery(services),
		getDelivery: createGetDeliveryQuery(services),
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
				'getDelivery',
				'getMemory',
				'getPlan',
				'getProject',
				'getRepository',
				'getSecret',
				'listDeliveries',
				'listMemories',
				'listPlans',
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
