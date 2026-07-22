import { computed, ref, type Ref } from 'vue'

import { useAuth, useSetAuth } from './session'
import { PortfolioCreationFormDraft, WorkspaceCreationFormDraft } from '../../forms/workspace'
import { selectedServerSocketIdentity } from '../../utils/selected-server-socket'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'
import { useServerSocketConnection } from '../core/server-socket'

type Workspace = Awaited<ReturnType<ServerApi['listWorkspaces']>>[number]
type Portfolio = Workspace['portfolios'][number]
type CreatedWorkspace = Awaited<ReturnType<ServerApi['createWorkspace']>>
type CreatedPortfolio = Awaited<ReturnType<ServerApi['createWorkspacePortfolio']>>
type SelectionAccess = Awaited<ReturnType<ServerApi['setSelection']>>
type QueryCacheAccess = ReturnType<typeof useQueryCache>

type WorkspaceCreationOptions = {
	onSuccess?: (workspace: CreatedWorkspace) => void | Promise<void>
}

type WorkspacePortfolioCreationOptions = {
	workspaces: Readonly<Ref<readonly Workspace[]>>
	onSuccess?: (portfolio: CreatedPortfolio) => void | Promise<void>
}

type PortfolioSelectionOptions = {
	onSuccess?: (selection: SelectionAccess) => void | Promise<void>
}

export function useWorkspacesList() {
	const serverApi = useServerApi()
	const { queryKeys } = useQueryCache()
	const {
		data: workspaces,
		isLoading: isLoadingWorkspaces,
		error: workspacesError,
		hasExecuted: hasLoadedWorkspaces,
		execute: refreshWorkspaces,
	} = useFetchAction(() => serverApi.listWorkspaces(), {
		queryKey: queryKeys.workspaces(),
		initialData: [] as Workspace[],
	})
	const isRefreshingWorkspaces = computed(() => isLoadingWorkspaces.value && hasLoadedWorkspaces.value)
	const hasSelectablePortfolios = computed(() => workspaces.value.some((workspace) => workspace.portfolios.length > 0))
	const hasNoSelectablePortfolios = computed(() => hasLoadedWorkspaces.value && !hasSelectablePortfolios.value)
	const hasNoWorkspaces = computed(() => hasLoadedWorkspaces.value && workspaces.value.length === 0)

	return {
		workspaces,
		isLoadingWorkspaces,
		workspacesError,
		hasLoadedWorkspaces,
		isRefreshingWorkspaces,
		refreshWorkspaces,
		hasSelectablePortfolios,
		hasNoSelectablePortfolios,
		hasNoWorkspaces,
	}
}

export function useWorkspaceCreation(options: WorkspaceCreationOptions = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { toast } = useOverlay()
	const workspaceCreationForm = new WorkspaceCreationFormDraft()
	const {
		isLoading: isCreatingWorkspace,
		error: createWorkspaceError,
		execute: createWorkspace,
		reset: resetCreateWorkspace,
	} = useApiAction(async () => {
		const workspace = await serverApi.createWorkspace(workspaceCreationForm.toModel())
		queryCache.invalidate(queryKeys.workspaces())
		workspaceCreationForm.reset()
		toast.success({ title: 'Workspace created.', body: workspace.displayName })
		await options.onSuccess?.(workspace)
		return workspace
	})

	return { workspaceCreationForm, isCreatingWorkspace, createWorkspaceError, createWorkspace, resetCreateWorkspace }
}

export function useWorkspacePortfolioCreation(options: WorkspacePortfolioCreationOptions) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { toast } = useOverlay()
	const portfolioCreationForm = new PortfolioCreationFormDraft()
	const portfolioCreationWorkspaceId = ref<string | null>(null)
	const {
		isLoading: isCreatingPortfolio,
		error: createPortfolioError,
		execute: createPortfolio,
		reset: resetCreatePortfolio,
	} = useApiAction(async () => {
		const workspaceId = requireActiveWorkspaceId(portfolioCreationWorkspaceId.value)
		const portfolio = await serverApi.createWorkspacePortfolio(workspaceId, portfolioCreationForm.toModel())
		writePortfolioToWorkspaceCache(queryCache, options.workspaces.value, portfolio)
		portfolioCreationForm.reset()
		portfolioCreationWorkspaceId.value = null
		toast.success({ title: 'Portfolio created.', body: portfolio.displayName })
		await options.onSuccess?.(portfolio)
		return portfolio
	})

	function openPortfolioCreation(workspaceId: string): void {
		if (portfolioCreationWorkspaceId.value !== workspaceId) {
			resetCreatePortfolio()
			portfolioCreationForm.reset()
		}
		portfolioCreationWorkspaceId.value = workspaceId
	}

	function closePortfolioCreation(): void {
		resetCreatePortfolio()
		portfolioCreationForm.reset()
		portfolioCreationWorkspaceId.value = null
	}

	function isPortfolioCreationOpen(workspaceId: string): boolean {
		return portfolioCreationWorkspaceId.value === workspaceId
	}

	return {
		portfolioCreationForm,
		portfolioCreationWorkspaceId,
		isCreatingPortfolio,
		createPortfolioError,
		createPortfolio,
		resetCreatePortfolio,
		openPortfolioCreation,
		closePortfolioCreation,
		isPortfolioCreationOpen,
	}
}

export function usePortfolioSelection(options: PortfolioSelectionOptions = {}) {
	const serverApi = useServerApi()
	const { session } = useAuth()
	const { setSelection } = useSetAuth()
	const { toast } = useOverlay()
	const selectingPortfolioKey = ref('')
	const {
		isLoading: isSelectingPortfolio,
		error: selectPortfolioError,
		execute: executeSelectPortfolio,
		reset: resetSelectPortfolio,
	} = useApiAction(async (workspaceId: string, portfolioId: string) => {
		const selection = await serverApi.setSelection(workspaceId, portfolioId)
		setSelection(selection)
		const currentSession = session.value
		if (!currentSession?.authenticated || !selection.selected)
			throw new Error('Selected Portfolio socket requires an authenticated Session and Selection')
		await useServerSocketConnection().reconnect(selectedServerSocketIdentity(currentSession, selection))
		toast.success({ title: 'Portfolio selected.' })
		await options.onSuccess?.(selection)
		return selection
	})

	async function selectPortfolio(workspaceId: string, portfolioId: string): Promise<void> {
		selectingPortfolioKey.value = portfolioActionKey(workspaceId, portfolioId)
		await executeSelectPortfolio(workspaceId, portfolioId)
	}

	function isSelectingThisPortfolio(workspaceId: string, portfolioId: string): boolean {
		return isSelectingPortfolio.value && selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId)
	}

	function portfolioSelectionError(workspaceId: string, portfolioId: string): string {
		return selectingPortfolioKey.value === portfolioActionKey(workspaceId, portfolioId) ? selectPortfolioError.value : ''
	}

	return {
		selectingPortfolioKey,
		isSelectingPortfolio,
		selectPortfolioError,
		selectPortfolio,
		resetSelectPortfolio,
		isSelectingThisPortfolio,
		portfolioSelectionError,
	}
}

function writePortfolioToWorkspaceCache(queryCache: QueryCacheAccess, cachedWorkspaces: readonly Workspace[], portfolio: Portfolio): void {
	let foundWorkspace = false
	const nextWorkspaces = cachedWorkspaces.map((workspace) => {
		if (workspace.id !== portfolio.workspaceId) return workspace
		foundWorkspace = true
		return {
			...workspace,
			portfolios: [portfolio, ...workspace.portfolios.filter((existingPortfolio) => existingPortfolio.id !== portfolio.id)],
		}
	})

	if (!foundWorkspace) {
		queryCache.invalidate(queryCache.queryKeys.workspaces())
		return
	}

	queryCache.set(queryCache.queryKeys.workspaces(), nextWorkspaces)
}

function requireActiveWorkspaceId(workspaceId: string | null): string {
	if (workspaceId === null) throw new Error('Choose a Workspace before creating a Portfolio')
	return workspaceId
}

function portfolioActionKey(workspaceId: string, portfolioId: string): string {
	return `${workspaceId}:${portfolioId}`
}
