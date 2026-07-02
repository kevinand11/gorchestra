import { computed, watch, type Ref } from 'vue'

import { defaultDeliveryWorkConfig, ProjectConfigFormDraft } from '../../../forms/project-config'
import { useSelectedPortfolio } from '../../auth/session'
import { useApiAction } from '../../core/action-state'
import { useOverlay } from '../../core/overlay'
import { useQueryCache } from '../../core/query-cache'
import { useServerApi } from '../../core/server-api'
import { usePortfolioConfig } from '../config'
import { useSelectModel } from '../models/select-model'
import { useProjectDetail } from '../projects'

export function useProjectConfig(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const projectConfigForm = new ProjectConfigFormDraft()
	const { queryKeys } = queryCache
	const projectState = useProjectDetail(projectId)
	const portfolioConfigState = usePortfolioConfig()
	const planningModelSelect = useSelectModel(projectConfigForm.planningModelUse, { optionalLabel: 'Use inherited/default' })
	const revisionPlanningModelSelect = useSelectModel(projectConfigForm.revisionPlanningModelUse, {
		providerState: planningModelSelect,
		optionalLabel: 'Use inherited/default',
	})
	const executionModelSelect = useSelectModel(projectConfigForm.executionModelUse, {
		providerState: planningModelSelect,
		optionalLabel: 'Use inherited/default',
	})
	const revisionExecutionModelSelect = useSelectModel(projectConfigForm.revisionExecutionModelUse, {
		providerState: planningModelSelect,
		optionalLabel: 'Use inherited/default',
	})
	const projectQueryKey = computed(() => queryKeys.portfolio.project(portfolio.value.id, projectId.value))
	const projectsQueryKey = computed(() => queryKeys.portfolio.projects(portfolio.value.id))
	const modelProvidersQueryKey = computed(() => queryKeys.portfolio.modelProviders(portfolio.value.id))
	const inheritedWorkConfig = computed(() => portfolioConfigState.portfolioConfig.value?.value.work ?? defaultDeliveryWorkConfig())

	watch(
		projectState.project,
		(project) => {
			if (project !== null) projectConfigForm.loadEntity({ config: project.config?.value ?? null })
		},
		{ immediate: true },
	)

	const {
		isLoading: isSavingProjectConfig,
		error: saveProjectConfigError,
		execute: saveProjectConfig,
		reset: resetSaveProjectConfig,
	} = useApiAction(async () => {
		const saved = await serverApi.setProjectConfig(projectId.value, projectConfigForm.toModel())
		queryCache.set(projectQueryKey.value, saved)
		queryCache.invalidate(projectsQueryKey.value, { exact: true })
		queryCache.invalidate(modelProvidersQueryKey.value)
		toast.success({ title: 'Project Config saved.', body: saved.title })
		return saved
	})

	function enableWorkOverride(): void {
		projectConfigForm.enableWorkOverrideFrom(inheritedWorkConfig.value)
	}

	function clearProjectOverrides(): void {
		projectConfigForm.clearOverrides(inheritedWorkConfig.value)
	}

	return {
		...projectState,
		portfolioConfig: portfolioConfigState.portfolioConfig,
		isLoadingPortfolioConfig: portfolioConfigState.isLoadingConfig,
		portfolioConfigError: portfolioConfigState.configError,
		hasLoadedPortfolioConfig: portfolioConfigState.hasLoadedConfig,
		inheritedWorkConfig,
		projectConfigForm,
		planningModelSelect,
		revisionPlanningModelSelect,
		executionModelSelect,
		revisionExecutionModelSelect,
		isSavingProjectConfig,
		saveProjectConfigError,
		saveProjectConfig,
		resetSaveProjectConfig,
		enableWorkOverride,
		clearProjectOverrides,
	}
}
