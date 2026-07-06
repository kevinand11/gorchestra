import type { CoreRuntime } from '../runtime'
import { createGetAgentRunProfileQuery } from './get-agent-run-profile'
import { createGetDeliveryQuery } from './get-delivery'
import { createGetMemoryQuery } from './get-memory'
import { createGetModelQuery } from './get-model'
import { createGetModelProviderQuery } from './get-model-provider'
import { createGetPlanQuery } from './get-plan'
import { createGetProjectQuery } from './get-project'
import { createGetRepositoryQuery } from './get-repository'
import { createGetSecretQuery } from './get-secret'
import { createListAgentRunEventsQuery } from './list-agent-run-events'
import { createListAgentRunProfileReferencesQuery } from './list-agent-run-profile-references'
import { createListAgentRunProfilesQuery } from './list-agent-run-profiles'
import { createListDeliveriesQuery } from './list-deliveries'
import { createListMemoryChildrenQuery } from './list-memory-children'
import { createListModelProvidersQuery } from './list-model-providers'
import { createListModelReferencesQuery } from './list-model-references'
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
		listAgentRunProfiles: createListAgentRunProfilesQuery(services),
		getAgentRunProfile: createGetAgentRunProfileQuery(services),
		listAgentRunProfileReferences: createListAgentRunProfileReferencesQuery(services),
		listModelProviders: createListModelProvidersQuery(services),
		getModel: createGetModelQuery(services),
		getModelProvider: createGetModelProviderQuery(services),
		listModelReferences: createListModelReferencesQuery(services),
		listAgentRunEvents: createListAgentRunEventsQuery(services),
		listPlans: createListPlansQuery(services),
		getPlan: createGetPlanQuery(services),
		listMemoryChildren: createListMemoryChildrenQuery(services),
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
				'listAgentRunEvents',
				'getAgentRunProfile',
				'getDelivery',
				'getMemory',
				'getModel',
				'getModelProvider',
				'getPlan',
				'getProject',
				'getRepository',
				'getSecret',
				'listAgentRunProfileReferences',
				'listAgentRunProfiles',
				'listDeliveries',
				'listMemoryChildren',
				'listModelProviders',
				'listModelReferences',
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
