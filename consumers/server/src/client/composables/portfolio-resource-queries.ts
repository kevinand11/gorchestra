import { computed, type Ref } from 'vue'

import { useFetchAction } from './action-state'
import { useQueryCache } from './query-cache'
import { useSelectedPortfolio } from './selected-portfolio'
import type { ServerApi } from './useServerApi'

type ListedMemory = Awaited<ReturnType<ServerApi['listMemoryChildren']>>[number]
type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>

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
