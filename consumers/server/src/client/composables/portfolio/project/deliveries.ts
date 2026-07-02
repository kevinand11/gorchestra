import { computed, type Ref } from 'vue'

import { useFetchAction } from '../../action-state'
import { useQueryCache } from '../../query-cache'
import { useSelectedPortfolio } from '../../selected-portfolio'
import { useServerApi, type ServerApi } from '../../useServerApi'

export type ListedDelivery = Awaited<ReturnType<ServerApi['listDeliveries']>>[number]
type DeliveryDetails = Awaited<ReturnType<ServerApi['getDelivery']>>

export function useDeliveriesList(projectId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: deliveries,
		isLoading: isLoadingDeliveries,
		error: deliveriesError,
		hasExecuted: hasLoadedDeliveries,
		execute: refreshDeliveries,
		reset: resetDeliveries,
	} = useFetchAction(() => serverApi.listDeliveries(projectId.value), {
		queryKey: queryKeys.portfolio.deliveries(portfolio.value.id, projectId.value),
		initialData: [] as ListedDelivery[],
	})
	const isRefreshingDeliveries = computed(() => isLoadingDeliveries.value && hasLoadedDeliveries.value)

	return {
		deliveries,
		isLoadingDeliveries,
		deliveriesError,
		hasLoadedDeliveries,
		isRefreshingDeliveries,
		refreshDeliveries,
		resetDeliveries,
	}
}

export function useDeliveryDetail(projectId: Ref<string>, deliveryId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: delivery,
		isLoading: isLoadingDelivery,
		error: deliveryError,
		hasExecuted: hasLoadedDelivery,
		execute: refreshDelivery,
		reset: resetDelivery,
	} = useFetchAction(() => serverApi.getDelivery(projectId.value, deliveryId.value), {
		queryKey: queryKeys.portfolio.delivery(portfolio.value.id, projectId.value, deliveryId.value),
		initialData: null as DeliveryDetails | null,
	})
	const isRefreshingDelivery = computed(() => isLoadingDelivery.value && hasLoadedDelivery.value)

	return {
		delivery,
		isLoadingDelivery,
		deliveryError,
		hasLoadedDelivery,
		isRefreshingDelivery,
		refreshDelivery,
		resetDelivery,
	}
}
