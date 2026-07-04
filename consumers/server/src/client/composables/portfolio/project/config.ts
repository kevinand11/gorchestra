import { computed, type Ref, watch } from 'vue'

import { ProjectConfigFormDraft } from '../../../forms/project-config'
import { useSelectedPortfolio } from '../../auth/session'
import { useApiAction } from '../../core/action-state'
import { useOverlay } from '../../core/overlay'
import { useQueryCache } from '../../core/query-cache'
import { useServerApi } from '../../core/server-api'
import { useAgentRunProfilesList } from '../agent-run-profiles'
import { useProjectDetail } from '../projects'

export function useProjectConfig(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { portfolio } = useSelectedPortfolio()
	const projectState = useProjectDetail(projectId)
	const profileState = useAgentRunProfilesList()
	const projectConfigForm = new ProjectConfigFormDraft()

	watch(
		() => projectState.project.value?.config ?? null,
		(config) => {
			if (config !== null) projectConfigForm.loadEntity({ config: config.value })
		},
		{ immediate: true },
	)

	const {
		isLoading: isSavingProjectConfig,
		error: saveProjectConfigError,
		execute: saveProjectConfig,
	} = useApiAction(async () => {
		const saved = await serverApi.setProjectConfig(projectId.value, projectConfigForm.toModel())
		queryCache.set(queryKeys.portfolio.project(portfolio.value.id, saved.id), saved)
		queryCache.invalidate(queryKeys.portfolio.projects(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id))
		toast.success({ title: 'Project Config saved.', body: saved.title })
		return saved
	})
	const isLoadingProjectConfig = computed(() => projectState.isLoadingProject.value || profileState.isLoadingAgentRunProfiles.value)
	const projectConfigError = computed(() => projectState.projectError.value || profileState.agentRunProfilesError.value)
	const hasLoadedProjectConfig = computed(() => projectState.hasLoadedProject.value && profileState.hasLoadedAgentRunProfiles.value)

	return {
		projectConfigForm,
		project: projectState.project,
		activeAgentRunProfileOptions: profileState.activeAgentRunProfileOptions,
		isLoadingProjectConfig,
		projectConfigError,
		hasLoadedProjectConfig,
		isSavingProjectConfig,
		saveProjectConfigError,
		saveProjectConfig,
	}
}
