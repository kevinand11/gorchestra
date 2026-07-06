import { computed, ref } from 'vue'

import { useSetAuth } from './session'
import { ProvisionWorkspaceFormDraft } from '../../forms/workspace'
import { useApiAction } from '../core/action-state'
import { useOverlay } from '../core/overlay'
import { usePaginatedFetchAction } from '../core/paginated-fetch-action'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'

type Workspace = Awaited<ReturnType<ServerApi['listWorkspaces']>>['items'][number]
type ProvisionDefaultWorkspaceResponse = Awaited<ReturnType<ServerApi['provisionDefaultWorkspace']>>
type SelectionAccess = Awaited<ReturnType<ServerApi['setSelection']>>

type DefaultWorkspaceProvisionOptions = {
	onSuccess?: (response: ProvisionDefaultWorkspaceResponse) => void | Promise<void>
}

type PortfolioSelectionOptions = {
	onSuccess?: (selection: SelectionAccess) => void | Promise<void>
}

export function useWorkspacesList() {
	const serverApi = useServerApi()
	const { queryKeys } = useQueryCache()
	const {
		items: workspaces,
		isLoading: isLoadingWorkspaces,
		error: workspacesError,
		hasExecuted: hasLoadedWorkspaces,
		fetchNext: fetchNextWorkspaces,
		hasNext: hasNextWorkspaces,
	} = usePaginatedFetchAction<Workspace>((input) => serverApi.listWorkspaces(input), {
		queryKey: queryKeys.workspaces(),
	})
	const isRefreshingWorkspaces = computed(() => isLoadingWorkspaces.value && hasLoadedWorkspaces.value)
	const hasSelectablePortfolios = computed(() => workspaces.value.some((workspace) => workspace.portfolios.length > 0))
	const hasNoSelectablePortfolios = computed(() => hasLoadedWorkspaces.value && !hasSelectablePortfolios.value)

	return {
		workspaces,
		isLoadingWorkspaces,
		workspacesError,
		hasLoadedWorkspaces,
		isRefreshingWorkspaces,
		fetchNextWorkspaces,
		hasNextWorkspaces,
		hasSelectablePortfolios,
		hasNoSelectablePortfolios,
	}
}

export function useDefaultWorkspaceProvision(options: DefaultWorkspaceProvisionOptions = {}) {
	const serverApi = useServerApi()
	const { setSelection } = useSetAuth()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const { toast } = useOverlay()
	const provisionWorkspaceForm = new ProvisionWorkspaceFormDraft()
	const {
		isLoading: isProvisioningWorkspace,
		error: provisionWorkspaceError,
		execute: provisionWorkspace,
		reset: resetProvisionWorkspace,
	} = useApiAction(async () => {
		const response = await serverApi.provisionDefaultWorkspace(provisionWorkspaceForm.toModel())
		queryCache.invalidate(queryKeys.workspaces())
		setSelection({
			selected: true,
			selection: response.selection,
			workspace: response.workspace,
			workspaceMember: response.workspaceMember,
			portfolio: response.portfolio,
			activeWorkspaceOwnerRole: response.workspaceOwnerRole,
		})
		toast.success({ title: 'Workspace created and Portfolio selected.' })
		await options.onSuccess?.(response)
		return response
	})

	return { provisionWorkspaceForm, isProvisioningWorkspace, provisionWorkspaceError, provisionWorkspace, resetProvisionWorkspace }
}

export function usePortfolioSelection(options: PortfolioSelectionOptions = {}) {
	const serverApi = useServerApi()
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

function portfolioActionKey(workspaceId: string, portfolioId: string): string {
	return `${workspaceId}:${portfolioId}`
}
