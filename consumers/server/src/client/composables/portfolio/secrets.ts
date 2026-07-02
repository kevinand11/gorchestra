import { computed } from 'vue'

import { useFetchAction } from '../action-state'
import { useQueryCache } from '../query-cache'
import { useSelectedPortfolio } from '../selected-portfolio'
import { useServerApi, type ServerApi } from '../useServerApi'

type ListedSecret = Awaited<ReturnType<ServerApi['listSecrets']>>[number]

export function useSecretsList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: secrets,
		isLoading: isLoadingSecrets,
		error: secretsError,
		hasExecuted: hasLoadedSecrets,
		execute: refreshSecrets,
		reset: resetSecrets,
	} = useFetchAction(() => serverApi.listSecrets(), {
		queryKey: queryKeys.portfolio.secrets(portfolio.value.id),
		initialData: [] as ListedSecret[],
	})
	const isRefreshingSecrets = computed(() => isLoadingSecrets.value && hasLoadedSecrets.value)

	return { secrets, isLoadingSecrets, secretsError, hasLoadedSecrets, isRefreshingSecrets, refreshSecrets, resetSecrets }
}

export function useActiveSecretSelectOptions() {
	const secretsList = useSecretsList()
	const activeSecrets = computed(() => secretsList.secrets.value.filter((secret) => !secret.archived))
	const activeSecretOptions = computed(() => activeSecrets.value.map((secret) => ({ value: secret.id, label: secret.name })))

	return { ...secretsList, activeSecrets, activeSecretOptions }
}
