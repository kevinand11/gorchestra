import type { Ref } from '@vue/reactivity'

import { useFetchAction } from './action-state'
import { useQueryCache } from './query-cache'
import { useSelectedPortfolio } from './selected-portfolio'
import type { ServerApi } from './useServerApi'

type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type RepositoryDetails = Awaited<ReturnType<ServerApi['getRepository']>>
type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]

export function usePortfolioProjectQuery(serverApi: ServerApi, projectId: Ref<string>) {
	const { portfolioId, queryKeys } = usePortfolioQueryContext()
	return useFetchAction(() => serverApi.getProject(projectId.value), {
		queryKey: queryKeys.portfolio.project(portfolioId.value, projectId.value),
		initialData: null as ProjectDetails | null,
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

function usePortfolioQueryContext() {
	const selectedPortfolio = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const portfolioId = computed(() => selectedPortfolio.value.portfolio.id)
	return { portfolioId, queryKeys }
}
