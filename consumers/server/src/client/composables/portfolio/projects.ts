import { computed, type Ref } from 'vue'

import { ProjectCreationFormDraft } from '../../forms/project'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { usePaginatedFetchAction } from '../core/paginated-fetch-action'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

export type ListedProject = Awaited<ReturnType<ServerApi['listProjects']>>['items'][number]
type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type CreatedProject = Awaited<ReturnType<ServerApi['createProject']>>

type ProjectsCreateOptions = {
	onSuccess?: (project: CreatedProject) => void | Promise<void>
}

export function useProjectsList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		items: projects,
		isLoading: isLoadingProjects,
		error: projectsError,
		hasExecuted: hasLoadedProjects,
		fetchNext: fetchNextProjects,
		hasNext: hasNextProjects,
	} = usePaginatedFetchAction((input) => serverApi.listProjects(input), {
		queryKey: queryKeys.portfolio.projects(portfolio.value.id),
	})
	const isRefreshingProjects = computed(() => isLoadingProjects.value && hasLoadedProjects.value)

	return { projects, isLoadingProjects, projectsError, hasLoadedProjects, isRefreshingProjects, fetchNextProjects, hasNextProjects }
}

export function useProjectDetail(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: project,
		isLoading: isLoadingProject,
		error: projectError,
		hasExecuted: hasLoadedProject,
		execute: refreshProject,
		reset: resetProject,
	} = useFetchAction(() => serverApi.getProject(projectId.value), {
		queryKey: queryKeys.portfolio.project(portfolio.value.id, projectId.value),
		initialData: null as ProjectDetails | null,
	})
	const isRefreshingProject = computed(() => isLoadingProject.value && hasLoadedProject.value)

	return { project, isLoadingProject, projectError, hasLoadedProject, isRefreshingProject, refreshProject, resetProject }
}

export function useProjectsCreate(options: ProjectsCreateOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const projectCreationForm = new ProjectCreationFormDraft()
	const { queryKeys } = queryCache
	const {
		isLoading: isCreatingProject,
		error: createProjectError,
		execute: createProject,
		reset: resetCreateProject,
	} = useApiAction(async () => {
		const project = await serverApi.createProject(projectCreationForm.toModel())
		queryCache.set(queryKeys.portfolio.project(portfolio.value.id, project.id), project)
		queryCache.invalidate(queryKeys.portfolio.projects(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id))
		toast.success({ title: 'Project created.', body: project.title })
		await options.onSuccess?.(project)
		return project
	})

	return { projectCreationForm, isCreatingProject, createProjectError, createProject, resetCreateProject }
}
