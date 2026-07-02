import { computed, ref } from 'vue'

import { ProvisionWorkspaceFormDraft } from '../../forms/workspace'
import { useApiAction, useFetchAction } from '../core/action-state'
import { useQueryCache } from '../core/query-cache'
import { useServerApi, type ServerApi } from '../core/server-api'
import { useToasts } from '../core/toasts'

type WorkspacePortfolios = Awaited<ReturnType<ServerApi['listWorkspacePortfolios']>>
type ProvisionDefaultWorkspaceResponse = Awaited<ReturnType<ServerApi['provisionDefaultWorkspace']>>
type SelectionAccess = Awaited<ReturnType<ServerApi['setSelection']>>

type DefaultWorkspaceProvisionOptions = {
	onSuccess?: (response: ProvisionDefaultWorkspaceResponse) => void | Promise<void>
}

type PortfolioSelectionOptions = {
	onSuccess?: (selection: SelectionAccess) => void | Promise<void>
}

export function useWorkspacePortfoliosList() {
	const serverApi = useServerApi()
	const { queryKeys } = useQueryCache()
	const {
		data: workspacePortfolios,
		isLoading: isLoadingWorkspacePortfolios,
		error: workspacePortfoliosError,
		hasExecuted: hasLoadedWorkspacePortfolios,
		execute: refreshWorkspacePortfolios,
		reset: resetWorkspacePortfolios,
	} = useFetchAction(() => serverApi.listWorkspacePortfolios(), {
		queryKey: queryKeys.workspacePortfolios(),
		initialData: [] as WorkspacePortfolios,
	})
	const isRefreshingWorkspacePortfolios = computed(() => isLoadingWorkspacePortfolios.value && hasLoadedWorkspacePortfolios.value)

	return {
		workspacePortfolios,
		isLoadingWorkspacePortfolios,
		workspacePortfoliosError,
		hasLoadedWorkspacePortfolios,
		isRefreshingWorkspacePortfolios,
		refreshWorkspacePortfolios,
		resetWorkspacePortfolios,
	}
}

export function useDefaultWorkspaceProvision(options: DefaultWorkspaceProvisionOptions = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const toasts = useToasts()
	const provisionWorkspaceForm = new ProvisionWorkspaceFormDraft()
	const {
		isLoading: isProvisioningWorkspace,
		error: provisionWorkspaceError,
		execute: provisionWorkspace,
		reset: resetProvisionWorkspace,
	} = useApiAction(async () => {
		const response = await serverApi.provisionDefaultWorkspace(provisionWorkspaceForm.toModel())
		queryCache.clear(['portfolio'])
		queryCache.invalidate(queryKeys.workspacePortfolios())
		queryCache.set(queryKeys.selection(), {
			selected: true,
			selection: response.selection,
			workspace: response.workspace,
			workspaceMember: response.workspaceMember,
			portfolio: response.portfolio,
			activeWorkspaceOwnerRole: response.workspaceOwnerRole,
		})
		toasts.success({ title: 'Workspace created and Portfolio selected.' })
		await options.onSuccess?.(response)
		return response
	})

	return { provisionWorkspaceForm, isProvisioningWorkspace, provisionWorkspaceError, provisionWorkspace, resetProvisionWorkspace }
}

export function usePortfolioSelection(options: PortfolioSelectionOptions = {}) {
	const serverApi = useServerApi()
	const queryCache = useQueryCache()
	const { queryKeys } = queryCache
	const toasts = useToasts()
	const selectingPortfolioKey = ref('')
	const {
		isLoading: isSelectingPortfolio,
		error: selectPortfolioError,
		execute: executeSelectPortfolio,
		reset: resetSelectPortfolio,
	} = useApiAction(async (workspaceId: string, portfolioId: string) => {
		const selection = await serverApi.setSelection(workspaceId, portfolioId)
		queryCache.clear(['portfolio'])
		queryCache.set(queryKeys.selection(), selection)
		toasts.success({ title: 'Portfolio selected.' })
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
