import { computed, watch } from 'vue'

import { PortfolioConfigFormDraft } from '../../forms/portfolio-config'
import { useApiAction, useFetchAction } from '../action-state'
import { useQueryCache } from '../query-cache'
import { useSelectedPortfolio } from '../selected-portfolio'
import { useToasts } from '../toasts'
import { useServerApi, type ServerApi } from '../useServerApi'

type PortfolioConfig = Awaited<ReturnType<ServerApi['getPortfolioConfig']>>

export function usePortfolioConfig() {
	const serverApi = useServerApi()
	const toasts = useToasts()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const configForm = new PortfolioConfigFormDraft()
	const { queryKeys } = queryCache
	const configQueryKey = computed(() => queryKeys.portfolio.portfolioConfig(portfolio.value.id))
	const {
		data: portfolioConfig,
		isLoading: isLoadingConfig,
		error: configError,
		hasExecuted: hasLoadedConfig,
		execute: refreshConfig,
		reset: resetConfig,
	} = useFetchAction(() => serverApi.getPortfolioConfig(), {
		queryKey: configQueryKey.value,
		initialData: null as PortfolioConfig,
	})
	const isRefreshingConfig = computed(() => isLoadingConfig.value && hasLoadedConfig.value)

	watch(
		portfolioConfig,
		(record) => {
			if (record !== null) configForm.loadEntity({ config: record.value })
		},
		{ immediate: true },
	)

	const {
		isLoading: isSavingConfig,
		error: saveConfigError,
		execute: saveConfig,
		reset: resetSaveConfig,
	} = useApiAction(async () => {
		const saved = await serverApi.setPortfolioConfig(configForm.toModel())
		queryCache.set(configQueryKey.value, saved)
		queryCache.invalidate(configQueryKey.value, { exact: true })
		toasts.success({ title: 'Portfolio Config saved.' })
		return saved
	})

	return {
		portfolioConfig,
		isLoadingConfig,
		configError,
		hasLoadedConfig,
		isRefreshingConfig,
		refreshConfig,
		resetConfig,
		configForm,
		isSavingConfig,
		saveConfigError,
		saveConfig,
		resetSaveConfig,
	}
}
