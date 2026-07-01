import { computed, type Ref } from 'vue'

import { useFetchAction } from './action-state'
import { useQueryCache } from './query-cache'
import { useSelectedPortfolio } from './selected-portfolio'
import type { ServerApi } from './useServerApi'

type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type ListedPlan = Awaited<ReturnType<ServerApi['listPlans']>>[number]
type PlanDetails = Awaited<ReturnType<ServerApi['getPlan']>>
type AgentRunEvent = Awaited<ReturnType<ServerApi['getAgentRunEvents']>>[number]
type ListedDelivery = Awaited<ReturnType<ServerApi['listDeliveries']>>[number]
type DeliveryDetails = Awaited<ReturnType<ServerApi['getDelivery']>>
type RepositoryDetails = Awaited<ReturnType<ServerApi['getRepository']>>
type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]
type ListedMemory = Awaited<ReturnType<ServerApi['listMemoryChildren']>>[number]
type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>

export function usePortfolioProjectQuery(serverApi: ServerApi, projectId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getProject(projectId.value), {
		queryKey: queryKeys.portfolio.project(portfolioId.value, projectId.value),
		initialData: null as ProjectDetails | null,
	})
}

export function usePortfolioPlansQuery(serverApi: ServerApi, projectId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listPlans(projectId.value), {
		queryKey: queryKeys.portfolio.plans(portfolioId.value, projectId.value),
		initialData: [] as ListedPlan[],
	})
}

export function usePortfolioPlanQuery(serverApi: ServerApi, projectId: Ref<string>, planId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getPlan(projectId.value, planId.value), {
		queryKey: queryKeys.portfolio.plan(portfolioId.value, projectId.value, planId.value),
		initialData: null as PlanDetails | null,
	})
}

export function usePortfolioAgentRunEventsQuery(serverApi: ServerApi, agentRunId: Ref<string | null>, cacheKey: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getAgentRunEvents(requireAgentRunId(agentRunId.value)), {
		queryKey: queryKeys.portfolio.agentRunEvents(portfolioId.value, cacheKey.value),
		initialData: [] as AgentRunEvent[],
		immediate: false,
	})
}

export function usePortfolioDeliveriesQuery(serverApi: ServerApi, projectId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.listDeliveries(projectId.value), {
		queryKey: queryKeys.portfolio.deliveries(portfolioId.value, projectId.value),
		initialData: [] as ListedDelivery[],
	})
}

export function usePortfolioDeliveryQuery(serverApi: ServerApi, projectId: Ref<string>, deliveryId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getDelivery(projectId.value, deliveryId.value), {
		queryKey: queryKeys.portfolio.delivery(portfolioId.value, projectId.value, deliveryId.value),
		initialData: null as DeliveryDetails | null,
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

function requireAgentRunId(agentRunId: string | null): string {
	if (agentRunId === null) throw new Error('Agent Run is not loaded yet')
	return agentRunId
}
