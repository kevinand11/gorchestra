import { computed, type Ref } from 'vue'

import { useFetchAction } from './action-state'
import { useQueryCache } from './query-cache'
import { useSelectedPortfolio } from './selected-portfolio'
import type { ServerApi } from './useServerApi'

type PortfolioConfig = Awaited<ReturnType<ServerApi['getPortfolioConfig']>>
type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]
type ModelProviderDetails = Awaited<ReturnType<ServerApi['getModelProvider']>>
type ModelDetails = Awaited<ReturnType<ServerApi['getModel']>>
type ModelReference = Awaited<ReturnType<ServerApi['listModelReferences']>>[number]
type RepositoryDetails = Awaited<ReturnType<ServerApi['getRepository']>>
type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]
type ListedMemory = Awaited<ReturnType<ServerApi['listMemoryChildren']>>[number]
type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>

export function usePortfolioConfigQuery(serverApi: ServerApi) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getPortfolioConfig(), {
		queryKey: queryKeys.portfolio.portfolioConfig(portfolioId.value),
		initialData: null as PortfolioConfig,
	})
}

export function usePortfolioModelProvidersQuery(serverApi: ServerApi) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listModelProviders(), {
		queryKey: queryKeys.portfolio.modelProviders(portfolioId.value),
		initialData: [] as ListedModelProvider[],
	})
}

export function usePortfolioModelProviderQuery(serverApi: ServerApi, modelProviderId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getModelProvider(modelProviderId.value), {
		queryKey: queryKeys.portfolio.modelProvider(portfolioId.value, modelProviderId.value),
		initialData: null as ModelProviderDetails | null,
	})
}

export function usePortfolioModelQuery(serverApi: ServerApi, modelProviderId: Ref<string>, modelId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getModel(modelProviderId.value, modelId.value), {
		queryKey: queryKeys.portfolio.model(portfolioId.value, modelProviderId.value, modelId.value),
		initialData: null as ModelDetails | null,
	})
}

export function usePortfolioModelReferencesQuery(serverApi: ServerApi, modelProviderId: Ref<string>, modelId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listModelReferences(modelProviderId.value, modelId.value), {
		queryKey: queryKeys.portfolio.modelReferences(portfolioId.value, modelProviderId.value, modelId.value),
		initialData: [] as ModelReference[],
	})
}

export function usePortfolioRepositoryQuery(serverApi: ServerApi, projectId: Ref<string>, repositoryId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getRepository(projectId.value, repositoryId.value), {
		queryKey: queryKeys.portfolio.repository(portfolioId.value, projectId.value, repositoryId.value),
		initialData: null as RepositoryDetails | null,
	})
}

export function usePortfolioSecretsQuery(serverApi: ServerApi) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listSecrets(), {
		queryKey: queryKeys.portfolio.secrets(portfolioId.value),
		initialData: [] as ListedSecret[],
	})
}

export function usePortfolioMemoryQuery(serverApi: ServerApi, memoryId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getMemory(memoryId.value), {
		queryKey: queryKeys.portfolio.memory(portfolioId.value, memoryId.value),
		initialData: null as MemoryDetails | null,
	})
}

export function usePortfolioMemoryChildrenQuery(serverApi: ServerApi, parentId: Ref<string | null>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listMemoryChildren(parentId.value), {
		queryKey: queryKeys.portfolio.memories(portfolioId.value, parentId.value ?? 'root'),
		initialData: [] as ListedMemory[],
	})
}

function usePortfolioQueryContext() {
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const portfolioId = computed(() => portfolio.value.id)
	return { portfolioId, queryKeys }
}
