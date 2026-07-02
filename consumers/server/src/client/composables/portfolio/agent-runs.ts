import { computed, type Ref } from 'vue'

import { AgentRunMessageFormDraft } from '../../forms/agent-run'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type AgentRunEvent = Awaited<ReturnType<ServerApi['getAgentRunEvents']>>[number]

type AgentRunMessageSendOptions = {
	agentRunEvents: Readonly<Ref<readonly AgentRunEvent[]>>
	hasLoadedAgentRunEvents: Readonly<Ref<boolean>>
}

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

export function useAgentRunMessageSend(agentRunId: Ref<string | null>, cacheKey: Ref<string>, options: AgentRunMessageSendOptions) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const agentRunMessageForm = new AgentRunMessageFormDraft()
	const eventsQueryKey = computed(() => queryCache.queryKeys.portfolio.agentRunEvents(portfolio.value.id, cacheKey.value))
	const {
		isLoading: isSendingAgentRunMessage,
		error: sendAgentRunMessageError,
		execute: sendAgentRunMessage,
		reset: resetSendAgentRunMessage,
	} = useApiAction(async () => {
		const event = await serverApi.sendAgentRunMessage(requireAgentRunId(agentRunId.value), agentRunMessageForm.toModel())
		if (options.hasLoadedAgentRunEvents.value) queryCache.set(eventsQueryKey.value, appendedEvent(options.agentRunEvents.value, event))
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

function appendedEvent(events: readonly AgentRunEvent[], event: AgentRunEvent): AgentRunEvent[] {
	return events.some((candidate) => candidate.id === event.id)
		? [...events]
		: [...events, event].sort((left, right) => left.sequence - right.sequence)
}

function requireAgentRunId(agentRunId: string | null): string {
	if (agentRunId === null) throw new Error('Agent Run is not loaded yet')
	return agentRunId
}
