import { computed, type Ref } from 'vue'

import { AgentRunProfileFormDraft } from '../../forms/agent-run-profile'
import { useSelectedPortfolio } from '../auth/session'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { usePaginatedFetchAction } from '../core/paginated-fetch-action'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type ListedAgentRunProfile = Awaited<ReturnType<ServerApi['listAgentRunProfiles']>>['items'][number]
type AgentRunProfileDetails = Awaited<ReturnType<ServerApi['getAgentRunProfile']>>
type SavedAgentRunProfile = Awaited<ReturnType<ServerApi['createAgentRunProfile']>>
type AgentRunProfileReference = Awaited<ReturnType<ServerApi['listAgentRunProfileReferences']>>[number]

export function useAgentRunProfilesList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		items: agentRunProfiles,
		isLoading: isLoadingAgentRunProfiles,
		error: agentRunProfilesError,
		hasExecuted: hasLoadedAgentRunProfiles,
		fetchNext: fetchNextAgentRunProfiles,
		hasNext: hasNextAgentRunProfiles,
	} = usePaginatedFetchAction((input) => serverApi.listAgentRunProfiles(input), {
		queryKey: queryKeys.portfolio.agentRunProfiles(portfolio.value.id),
	})
	const isRefreshingAgentRunProfiles = computed(() => isLoadingAgentRunProfiles.value && hasLoadedAgentRunProfiles.value)
	const activeAgentRunProfiles = computed(() => agentRunProfiles.value.filter((profile) => !profile.archived))
	const activeAgentRunProfileOptions = computed(() =>
		activeAgentRunProfiles.value.map((profile) => ({ value: profile.id, label: profile.name })),
	)

	return {
		agentRunProfiles,
		activeAgentRunProfiles,
		activeAgentRunProfileOptions,
		isLoadingAgentRunProfiles,
		agentRunProfilesError,
		hasLoadedAgentRunProfiles,
		isRefreshingAgentRunProfiles,
		fetchNextAgentRunProfiles,
		hasNextAgentRunProfiles,
	}
}

export function useAgentRunProfileDetail(agentRunProfileId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: agentRunProfile,
		isLoading: isLoadingAgentRunProfile,
		error: agentRunProfileError,
		hasExecuted: hasLoadedAgentRunProfile,
		execute: refreshAgentRunProfile,
		reset: resetAgentRunProfile,
	} = useFetchAction(() => serverApi.getAgentRunProfile(agentRunProfileId.value), {
		queryKey: queryKeys.portfolio.agentRunProfile(portfolio.value.id, agentRunProfileId.value),
		initialData: null as AgentRunProfileDetails | null,
	})
	const isRefreshingAgentRunProfile = computed(() => isLoadingAgentRunProfile.value && hasLoadedAgentRunProfile.value)

	return {
		agentRunProfile,
		isLoadingAgentRunProfile,
		agentRunProfileError,
		hasLoadedAgentRunProfile,
		isRefreshingAgentRunProfile,
		refreshAgentRunProfile,
		resetAgentRunProfile,
	}
}

export function useAgentRunProfileReferences(agentRunProfileId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: agentRunProfileReferences,
		isLoading: isLoadingAgentRunProfileReferences,
		error: agentRunProfileReferencesError,
		hasExecuted: hasLoadedAgentRunProfileReferences,
		execute: refreshAgentRunProfileReferences,
		reset: resetAgentRunProfileReferences,
	} = useFetchAction(() => serverApi.listAgentRunProfileReferences(agentRunProfileId.value), {
		queryKey: queryKeys.portfolio.agentRunProfileReferences(portfolio.value.id, agentRunProfileId.value),
		initialData: [] as AgentRunProfileReference[],
	})
	const isRefreshingAgentRunProfileReferences = computed(
		() => isLoadingAgentRunProfileReferences.value && hasLoadedAgentRunProfileReferences.value,
	)

	return {
		agentRunProfileReferences,
		isLoadingAgentRunProfileReferences,
		agentRunProfileReferencesError,
		hasLoadedAgentRunProfileReferences,
		isRefreshingAgentRunProfileReferences,
		refreshAgentRunProfileReferences,
		resetAgentRunProfileReferences,
	}
}

export function useAgentRunProfileCreate(options: { onSuccess?: (profile: SavedAgentRunProfile) => void | Promise<void> } = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { portfolio } = useSelectedPortfolio()
	const { toast } = useOverlay()
	const agentRunProfileForm = new AgentRunProfileFormDraft()
	const {
		isLoading: isCreatingAgentRunProfile,
		error: createAgentRunProfileError,
		execute: createAgentRunProfile,
	} = useApiAction(async () => {
		const profile = await serverApi.createAgentRunProfile(agentRunProfileForm.toModel())
		queryCache.set(queryKeys.portfolio.agentRunProfile(portfolio.value.id, profile.id), listedAgentRunProfile(profile))
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id))
		toast.success({ title: 'Agent Run Profile created.', body: profile.name })
		await options.onSuccess?.(profile)
		return profile
	})

	return { agentRunProfileForm, isCreatingAgentRunProfile, createAgentRunProfileError, createAgentRunProfile }
}

export function useAgentRunProfileUpdate(agentRunProfileId: Ref<string>) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { portfolio } = useSelectedPortfolio()
	const { toast } = useOverlay()
	const agentRunProfileForm = new AgentRunProfileFormDraft()
	const {
		isLoading: isUpdatingAgentRunProfile,
		error: updateAgentRunProfileError,
		execute: updateAgentRunProfile,
	} = useApiAction(async () => {
		const profile = await serverApi.updateAgentRunProfile(agentRunProfileId.value, agentRunProfileForm.toModel())
		queryCache.set(queryKeys.portfolio.agentRunProfile(portfolio.value.id, profile.id), listedAgentRunProfile(profile))
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id))
		toast.success({ title: 'Agent Run Profile saved.', body: profile.name })
		return profile
	})

	return { agentRunProfileForm, isUpdatingAgentRunProfile, updateAgentRunProfileError, updateAgentRunProfile }
}

export function useAgentRunProfilePreflight(agentRunProfileId: Ref<string>) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const {
		isLoading: isPreflightingAgentRunProfile,
		error: preflightAgentRunProfileError,
		execute: preflightAgentRunProfile,
	} = useApiAction(async () => {
		const evidence = await serverApi.preflightAgentRunProfile(agentRunProfileId.value)
		if (evidence.passed) toast.success({ title: 'Agent Run Profile preflight passed.', body: evidence.summary })
		else toast.error({ title: 'Agent Run Profile preflight failed.', body: evidence.summary })
		return evidence
	})

	return { isPreflightingAgentRunProfile, preflightAgentRunProfileError, preflightAgentRunProfile }
}

export function useAgentRunProfileArchiveActions() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { portfolio } = useSelectedPortfolio()
	const { toast } = useOverlay()
	const {
		isLoading: isArchivingAgentRunProfile,
		error: archiveAgentRunProfileError,
		execute: archiveAgentRunProfile,
	} = useApiAction(async (profile: ListedAgentRunProfile) => {
		const archived = await serverApi.archiveAgentRunProfile(profile.id)
		queryCache.set(queryKeys.portfolio.agentRunProfile(portfolio.value.id, archived.id), listedAgentRunProfile(archived))
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id))
		toast.success({ title: 'Agent Run Profile archived.', body: archived.name })
		return archived
	})
	const {
		isLoading: isUnarchivingAgentRunProfile,
		error: unarchiveAgentRunProfileError,
		execute: unarchiveAgentRunProfile,
	} = useApiAction(async (profile: ListedAgentRunProfile) => {
		const unarchived = await serverApi.unarchiveAgentRunProfile(profile.id)
		queryCache.set(queryKeys.portfolio.agentRunProfile(portfolio.value.id, unarchived.id), listedAgentRunProfile(unarchived))
		queryCache.invalidate(queryKeys.portfolio.agentRunProfiles(portfolio.value.id), { exact: true })
		queryCache.invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id))
		toast.success({ title: 'Agent Run Profile unarchived.', body: unarchived.name })
		return unarchived
	})

	return {
		isArchivingAgentRunProfile,
		archiveAgentRunProfileError,
		archiveAgentRunProfile,
		isUnarchivingAgentRunProfile,
		unarchiveAgentRunProfileError,
		unarchiveAgentRunProfile,
	}
}

function listedAgentRunProfile(profile: SavedAgentRunProfile): AgentRunProfileDetails {
	return {
		id: profile.id,
		name: profile.name,
		modelUse: profile.modelUse,
		runtimeRequirements: profile.runtimeRequirements,
		sandboxConfig: profile.sandboxConfig,
		created: profile.created,
		updated: profile.updated,
		archived: profile.archivePeriods.at(-1)?.unarchived === null,
	}
}
