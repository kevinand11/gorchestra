import { createGetAgentRunQuery } from './get-agent-run'
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
import type { CoreRuntime } from '../utils/runtime'

export function createCoreQueries(runtime: CoreRuntime) {
	const transactions = runtime.transactions

	return {
		listProjects: createListProjectsQuery(transactions),
		getProject: createGetProjectQuery(transactions),
		listAgentRunProfiles: createListAgentRunProfilesQuery(transactions),
		getAgentRunProfile: createGetAgentRunProfileQuery(transactions),
		listAgentRunProfileReferences: createListAgentRunProfileReferencesQuery(transactions),
		listModelProviders: createListModelProvidersQuery(transactions),
		getModel: createGetModelQuery(transactions),
		getModelProvider: createGetModelProviderQuery(transactions),
		listModelReferences: createListModelReferencesQuery(transactions),
		getAgentRun: createGetAgentRunQuery(transactions),
		listAgentRunEvents: createListAgentRunEventsQuery(transactions),
		listPlans: createListPlansQuery(transactions),
		getPlan: createGetPlanQuery(transactions),
		listMemoryChildren: createListMemoryChildrenQuery(transactions),
		getMemory: createGetMemoryQuery(transactions),
		listDeliveries: createListDeliveriesQuery(transactions),
		getDelivery: createGetDeliveryQuery(transactions),
		listRepositories: createListRepositoriesQuery(transactions),
		getRepository: createGetRepositoryQuery(transactions),
		listSecrets: createListSecretsQuery(transactions),
		getSecret: createGetSecretQuery(transactions),
		listSecretReferences: createListSecretReferencesQuery(transactions),
	}
}

export type Core = ReturnType<typeof createCoreQueries>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createCoreRuntime } = await import('../utils/runtime')
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('Core queries', () => {
		it('returns an object with the expected query keys', () => {
			const queries = createCoreQueries(createCoreRuntime(createTestCoreServices())) as Record<string, unknown>
			const queryNames = [
				'getAgentRun',
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
