import { computed, type Ref } from 'vue'

import { AgentRunMessageFormDraft } from '../../forms/agent-run'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction } from '../core/action-state'
import { usePaginatedFetchAction } from '../core/paginated-fetch-action'
import { useQueryCache } from '../core/query-cache'
import { useServerApi } from '../core/server-api'

export function useAgentRunEvents(agentRunId: Ref<string | null>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		items: fetchedAgentRunEvents,
		isLoading: isLoadingAgentRunEvents,
		error: agentRunEventsError,
		hasExecuted: hasLoadedAgentRunEvents,
		fetchNext: fetchNextAgentRunEvents,
		hasNext: hasNextAgentRunEvents,
	} = usePaginatedFetchAction((input) => serverApi.listAgentRunEvents(requireAgentRunId(agentRunId.value), input), {
		queryKey: () => queryKeys.portfolio.agentRunEvents(portfolio.value.id, requireAgentRunId(agentRunId.value)),
		limit: 200,
	})
	const agentRunEvents = computed(() => [...fetchedAgentRunEvents.value].reverse())
	const isRefreshingAgentRunEvents = computed(() => isLoadingAgentRunEvents.value && hasLoadedAgentRunEvents.value)

	return {
		agentRunEvents,
		isLoadingAgentRunEvents,
		agentRunEventsError,
		hasLoadedAgentRunEvents,
		isRefreshingAgentRunEvents,
		fetchNextAgentRunEvents,
		hasNextAgentRunEvents,
	}
}

export function useAgentRunMessageSend(agentRunId: Ref<string | null>) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const agentRunMessageForm = new AgentRunMessageFormDraft()
	const {
		isLoading: isSendingAgentRunMessage,
		error: sendAgentRunMessageError,
		execute: sendAgentRunMessage,
		reset: resetSendAgentRunMessage,
	} = useApiAction(async () => {
		const runId = requireAgentRunId(agentRunId.value)
		const event = await serverApi.sendAgentRunMessage(runId, agentRunMessageForm.toModel())
		queryCache.invalidate(queryCache.queryKeys.portfolio.agentRunEvents(portfolio.value.id, runId), { exact: true })
		agentRunMessageForm.clear()
		return event
	})

	return {
		agentRunMessageForm,
		isSendingAgentRunMessage,
		sendAgentRunMessageError,
		sendAgentRunMessage,
		resetSendAgentRunMessage,
	}
}

function requireAgentRunId(agentRunId: string | null): string {
	if (agentRunId === null) throw new Error('Agent Run is not loaded yet')
	return agentRunId
}
