import { computed, type Ref } from 'vue'

import { useSelectedPortfolio } from '../auth/session'
import { useFetchAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type AgentRunEvent = Awaited<ReturnType<ServerApi['getAgentRunEvents']>>[number]

export function useAgentRunEvents(agentRunId: Ref<string | null>, cacheKey: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: agentRunEvents,
		isLoading: isLoadingAgentRunEvents,
		error: agentRunEventsError,
		hasExecuted: hasLoadedAgentRunEvents,
		execute: refreshAgentRunEvents,
		reset: resetAgentRunEvents,
	} = useFetchAction(() => serverApi.getAgentRunEvents(requireAgentRunId(agentRunId.value)), {
		queryKey: queryKeys.portfolio.agentRunEvents(portfolio.value.id, cacheKey.value),
		initialData: [] as AgentRunEvent[],
		immediate: false,
	})
	const isRefreshingAgentRunEvents = computed(() => isLoadingAgentRunEvents.value && hasLoadedAgentRunEvents.value)

	return {
		agentRunEvents,
		isLoadingAgentRunEvents,
		agentRunEventsError,
		hasLoadedAgentRunEvents,
		isRefreshingAgentRunEvents,
		refreshAgentRunEvents,
		resetAgentRunEvents,
	}
}

function requireAgentRunId(agentRunId: string | null): string {
	if (agentRunId === null) throw new Error('Agent Run is not loaded yet')
	return agentRunId
}
