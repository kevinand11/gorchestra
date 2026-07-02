import { computed, ref, type Ref } from 'vue'

import { RepositoryCreationFormDraft } from '../../../forms/repository'
import { useApiAction, useFetchAction } from '../../action-state'
import { useQueryCache } from '../../query-cache'
import { useSelectedPortfolio } from '../../selected-portfolio'
import { useToasts } from '../../toasts'
import { useServerApi, type ServerApi } from '../../useServerApi'

export type ListedRepository = Awaited<ReturnType<ServerApi['listRepositories']>>[number]
type RepositoryDetails = Awaited<ReturnType<ServerApi['getRepository']>>
type CreatedRepository = Awaited<ReturnType<ServerApi['createRepository']>>
type RepositoryPreflightEvidence = Awaited<ReturnType<ServerApi['preflightRepository']>>

type RepositoriesCreateOptions = {
	onSuccess?: (repository: CreatedRepository) => void | Promise<void>
}

export function useRepositoriesList(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: repositories,
		isLoading: isLoadingRepositories,
		error: repositoriesError,
		hasExecuted: hasLoadedRepositories,
		execute: refreshRepositories,
		reset: resetRepositories,
	} = useFetchAction(() => serverApi.listRepositories(projectId.value), {
		queryKey: queryKeys.portfolio.repositories(portfolio.value.id, projectId.value),
		initialData: [] as ListedRepository[],
	})
	const isRefreshingRepositories = computed(() => isLoadingRepositories.value && hasLoadedRepositories.value)

	return {
		repositories,
		isLoadingRepositories,
		repositoriesError,
		hasLoadedRepositories,
		isRefreshingRepositories,
		refreshRepositories,
		resetRepositories,
	}
}

export function useRepositoryDetail(projectId: Ref<string>, repositoryId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: repository,
		isLoading: isLoadingRepository,
		error: repositoryError,
		hasExecuted: hasLoadedRepository,
		execute: refreshRepository,
		reset: resetRepository,
	} = useFetchAction(() => serverApi.getRepository(projectId.value, repositoryId.value), {
		queryKey: queryKeys.portfolio.repository(portfolio.value.id, projectId.value, repositoryId.value),
		initialData: null as RepositoryDetails | null,
	})
	const isRefreshingRepository = computed(() => isLoadingRepository.value && hasLoadedRepository.value)

	return {
		repository,
		isLoadingRepository,
		repositoryError,
		hasLoadedRepository,
		isRefreshingRepository,
		refreshRepository,
		resetRepository,
	}
}

export function useRepositoriesCreate(projectId: Ref<string>, options: RepositoriesCreateOptions = {}) {
	const serverApi = useServerApi()
	const toasts = useToasts()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const repositoryCreationForm = new RepositoryCreationFormDraft()
	const { queryKeys } = queryCache
	const {
		isLoading: isCreatingRepository,
		error: createRepositoryError,
		execute: createRepository,
		reset: resetCreateRepository,
	} = useApiAction(async () => {
		const repository = await serverApi.createRepository(projectId.value, repositoryCreationForm.toModel())
		queryCache.set(queryKeys.portfolio.repository(portfolio.value.id, projectId.value, repository.id), repository)
		queryCache.invalidate(queryKeys.portfolio.repositories(portfolio.value.id, projectId.value), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.project(portfolio.value.id, projectId.value), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.projects(portfolio.value.id), { exact: true })
		toasts.success({ title: 'Repository created.', body: `${repository.config.owner}/${repository.config.name}` })
		await options.onSuccess?.(repository)
		return repository
	})

	return { repositoryCreationForm, isCreatingRepository, createRepositoryError, createRepository, resetCreateRepository }
}

export function useRepositoryPreflight(projectId: Ref<string>, repositoryId: Ref<string>) {
	const serverApi = useServerApi()
	const toasts = useToasts()
	const preflightEvidence = ref<RepositoryPreflightEvidence | null>(null)
	const {
		isLoading: isPreflightingRepository,
		error: preflightRepositoryError,
		execute: preflightRepository,
		reset: resetRepositoryPreflight,
	} = useApiAction(async () => {
		const evidence = await serverApi.preflightRepository(projectId.value, repositoryId.value)
		preflightEvidence.value = evidence
		if (evidence.passed) toasts.success({ title: 'Repository preflight passed.', body: evidence.summary })
		else toasts.info({ title: 'Repository preflight failed.', body: evidence.summary })
		return evidence
	})

	return {
		preflightEvidence,
		isPreflightingRepository,
		preflightRepositoryError,
		preflightRepository,
		resetRepositoryPreflight,
	}
}
