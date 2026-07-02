import { fetchSelection, fetchSession, loadSelection, loadSessionWithRefresh, type Selection, type Session } from '../../utils/sessions'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi } from '../core/server-api'
import { useToasts } from '../core/toasts'

export function useAuth() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()

	const { data: session } = useFetchAction(() => fetchSession(serverApi), {
		queryKey: queryCache.queryKeys.session(),
		initialData: null as Session | null,
	})

	const { data: selection } = useFetchAction(() => fetchSelection(serverApi), {
		queryKey: queryCache.queryKeys.selection(),
		initialData: null as Selection | null,
	})

	const setSession = (session: Session | null) => {
		queryCache.clear([])
		if (session !== null) queryCache.set(queryCache.queryKeys.session(), session)
	}

	const setSelection = (selection: Selection | null) => {
		queryCache.clear(['portfolio'])
		queryCache.clear(queryCache.queryKeys.selection(), { exact: true })
		if (selection !== null) queryCache.set(queryCache.queryKeys.selection(), selection)
	}

	return { session, selection, setSession, setSelection }
}

export function useSessionLoaders() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()

	return {
		loadSession: async () => await loadSessionWithRefresh(serverApi, queryCache),
		loadSelection: async () => await loadSelection(serverApi, queryCache),
	}
}

export function useSelectionClear() {
	const serverApi = useServerApi()
	const { setSelection } = useAuth()
	const toasts = useToasts()

	const {
		isLoading: isClearingSelection,
		error: clearSelectionError,
		execute: clearSelection,
		reset: resetClearSelection,
	} = useApiAction(async () => {
		await serverApi.clearSelection()
		setSelection(null)
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
	const { selection } = useAuth()
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
