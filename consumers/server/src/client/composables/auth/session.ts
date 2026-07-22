import {
	runWithServerSocketDisconnected,
	selectedServerSocketIdentity,
	selectedServerSocketIdentityOrNull,
} from '../../utils/selected-server-socket'
import { fetchSelection, fetchSession, loadSelection, loadSessionWithRefresh, type Selection, type Session } from '../../utils/sessions'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { useQueryCache } from '../core/query-cache'
import { useServerApi } from '../core/server-api'
import { useServerSocketConnection } from '../core/server-socket'

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

	return { session, selection }
}

export function useSetAuth() {
	const queryCache = useQueryCache()

	const setSession = (session: Session | null) => {
		queryCache.clear([])
		if (session !== null) queryCache.set(queryCache.queryKeys.session(), session)
	}

	const setSelection = (selection: Selection | null) => {
		queryCache.clear(['portfolio'])
		queryCache.clear(queryCache.queryKeys.selection(), { exact: true })
		if (selection !== null) queryCache.set(queryCache.queryKeys.selection(), selection)
	}

	return { setSession, setSelection }
}

export function useSessionLoaders() {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()

	return {
		loadSession: async () =>
			await loadSessionWithRefresh(
				serverApi,
				queryCache,
				undefined,
				typeof window === 'undefined'
					? undefined
					: async (session) => {
							const serverSocket = useServerSocketConnection()
							const selection = await loadSelection(serverApi, queryCache)
							if (!selection.selected) return serverSocket.disconnect()
							await serverSocket.connect(selectedServerSocketIdentity(session, selection))
						},
			),
		loadSelection: async () => await loadSelection(serverApi, queryCache),
	}
}

export function useSelectionClear() {
	const serverApi = useServerApi()
	const { session, selection } = useAuth()
	const { setSelection } = useSetAuth()
	const { toast } = useOverlay()

	const {
		isLoading: isClearingSelection,
		error: clearSelectionError,
		execute: clearSelection,
		reset: resetClearSelection,
	} = useApiAction(async () => {
		const serverSocket = useServerSocketConnection()
		await runWithServerSocketDisconnected({
			identity: selectedServerSocketIdentityOrNull(session.value, selection.value),
			disconnect: serverSocket.disconnect,
			connect: serverSocket.connect,
			run: async () => {
				await serverApi.clearSelection()
				setSelection(null)
				toast.info({ title: 'Selection cleared.' })
			},
		})
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
	const { session, selection } = useAuth()
	const queryCache = useQueryCache()
	const {
		isLoading: isSigningOut,
		error: signOutError,
		execute: signOut,
		reset: resetSignOut,
	} = useApiAction(async () => {
		const serverSocket = useServerSocketConnection()
		await runWithServerSocketDisconnected({
			identity: selectedServerSocketIdentityOrNull(session.value, selection.value),
			disconnect: serverSocket.disconnect,
			connect: serverSocket.connect,
			run: async () => {
				await serverApi.logout()
				queryCache.clear([])
				await navigateTo('/sign-in')
			},
		})
	})

	return { isSigningOut, signOutError, signOut, resetSignOut }
}
