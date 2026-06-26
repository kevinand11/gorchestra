import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'

import { useFetchAction } from './action-state'
import { useQueryCache, useQueryCacheControllerForFetch } from './query-cache'
import { useSelectedPortfolio } from './selected-portfolio'
import type { ListMemoriesInput, ServerApi } from './useServerApi'

type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type ListedPlan = Awaited<ReturnType<ServerApi['listPlans']>>[number]
type PlanDetails = Awaited<ReturnType<ServerApi['getPlan']>>
type ListedDelivery = Awaited<ReturnType<ServerApi['listDeliveries']>>[number]
type DeliveryDetails = Awaited<ReturnType<ServerApi['getDelivery']>>
type RepositoryDetails = Awaited<ReturnType<ServerApi['getRepository']>>
type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]
type ListedMemory = Awaited<ReturnType<ServerApi['listMemories']>>[number]
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

export function usePortfolioMemoriesQuery(serverApi: ServerApi, input: Ref<ListMemoriesInput>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	const controller = useQueryCacheControllerForFetch()
	const data = shallowRef([] as ListedMemory[])
	const isLoading = ref(false)
	const error = ref('')
	const hasExecuted = ref(false)
	let detach = () => {}
	let fetchVersion = 0
	const observer = {
		queryKey: memoryQueryKey(queryKeys, portfolioId.value, input.value),
		initialData: () => [] as ListedMemory[],
		data,
		isLoading,
		error,
		hasExecuted,
		immediate: true,
		fetcher: async () => await serverApi.listMemories(input.value),
	}

	watch(
		() => memoryQueryKey(queryKeys, portfolioId.value, input.value),
		(queryKey) => {
			fetchVersion += 1
			const version = fetchVersion
			detach()
			observer.queryKey = queryKey
			observer.fetcher = async () => await serverApi.listMemories(input.value)
			detach = controller.attach(observer)
			void controller.ensure(observer).catch((fetchError: unknown) => {
				if (version === fetchVersion) error.value = fetchError instanceof Error ? fetchError.message : String(fetchError)
			})
		},
		{ immediate: true },
	)
	onScopeDispose(() => detach())

	return {
		data: computed(() => data.value),
		isLoading,
		error,
		hasExecuted,
		execute: () => controller.refetch(observer),
		reset: () => (error.value = ''),
	}
}

function memoryQueryKey(queryKeys: ReturnType<typeof useQueryCache>['queryKeys'], portfolioId: string, input: ListMemoriesInput) {
	return queryKeys.portfolio.memories(
		portfolioId,
		input.status,
		input.search ?? 'null',
		JSON.stringify(input.typeFilter),
		JSON.stringify(input.linkFilter),
	)
}

function usePortfolioQueryContext() {
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const portfolioId = computed(() => portfolio.value.id)
	return { portfolioId, queryKeys }
}
