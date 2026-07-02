import { computed, watch } from 'vue'

import { PortfolioConfigFormDraft } from '../../forms/portfolio-config'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type PortfolioConfig = Awaited<ReturnType<ServerApi['getPortfolioConfig']>>

export function usePortfolioConfig() {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
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
		toast.success({ title: 'Portfolio Config saved.' })
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
