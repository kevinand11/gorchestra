import { useApiAction, useFetchAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'
import { useToasts } from '../core/toasts'

type SessionStatus = Awaited<ReturnType<ServerApi['getSession']>>
type SelectionAccess = Awaited<ReturnType<ServerApi['getSelection']>>

export function useSession() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache

	// TODO: need to implement refrsh session if recommended, but this is a bit tricky because we need to avoid infinite loops when the refresh fails and we get a new session that also needs to be refreshed. For now, we'll just fetch the session and selection without refreshing.

	const { data: session } = useFetchAction(() => serverApi.getSession(), {
		queryKey: queryKeys.session(),
		initialData: null as SessionStatus | null,
	})

	const { data: selection } = useFetchAction(() => serverApi.getSelection(), {
		queryKey: queryKeys.selection(),
		initialData: null as SelectionAccess | null,
	})

	return {
		session,
		selection,
	}
}

export function useSelectionClear() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const toasts = useToasts()

	const {
		isLoading: isClearingSelection,
		error: clearSelectionError,
		execute: clearSelection,
		reset: resetClearSelection,
	} = useApiAction(async () => {
		await serverApi.clearSelection()
		queryCache.clear(['portfolio'])
		queryCache.set(queryCache.queryKeys.selection(), { selected: false, reason: 'missing-token' })
		toasts.info({ title: 'Selection cleared.' })
	})

	return {
		isClearingSelection,
		clearSelectionError,
		clearSelection,
		resetClearSelection,
	}
}

export function useSelectedPortfolio() {
	const { selection } = useSession()
	const selected = computed(() => {
		const select = selection.value
		if (!select || !select.selected) throw new Error('Selected Portfolio context requires a valid selected Workspace and Portfolio')
		return select
	})
	const workspace = computed(() => selected.value.workspace)
	const portfolio = computed(() => selected.value.portfolio)
	return { workspace, portfolio }
}

export function useSignout() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const {
		isLoading: isSigningOut,
		error: signOutError,
		execute: signOut,
		reset: resetSignOut,
	} = useApiAction(async () => {
		await serverApi.logout()
		queryCache.clear([])
		await navigateTo('/sign-in')
	})

	return { isSigningOut, signOutError, signOut, resetSignOut }
}
