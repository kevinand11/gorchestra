import { computed, ref } from 'vue'

import { ProvisionWorkspaceFormDraft } from '../../forms/workspace'
import { useApiAction, useFetchAction } from '../action-state'
import { useAuthState, useSelectionAccess } from '../auth-state'
import { useQueryCache } from '../query-cache'
import { useToasts } from '../toasts'
import { useServerApi, type ServerApi } from '../useServerApi'

type WorkspacePortfolios = Awaited<ReturnType<ServerApi['listWorkspacePortfolios']>>
type ProvisionDefaultWorkspaceResponse = Awaited<ReturnType<ServerApi['provisionDefaultWorkspace']>>
type SelectionAccess = Awaited<ReturnType<ServerApi['setSelection']>>

type DefaultWorkspaceProvisionOptions = {
	onSuccess?: (response: ProvisionDefaultWorkspaceResponse) => void | Promise<void>
}

type PortfolioSelectionOptions = {
	onSuccess?: (selection: SelectionAccess) => void | Promise<void>
}

export function useCurrentSelection() {
	const {
		data: selection,
		isLoading: isLoadingSelection,
		error: selectionError,
		hasExecuted: hasLoadedSelection,
		execute: refreshSelection,
		reset: resetSelection,
	} = useSelectionAccess({ immediate: true })
	const isRefreshingSelection = computed(() => isLoadingSelection.value && hasLoadedSelection.value)

	return { selection, isLoadingSelection, selectionError, hasLoadedSelection, isRefreshingSelection, refreshSelection, resetSelection }
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
	const authState = useAuthState()
	const toasts = useToasts()
	const provisionWorkspaceForm = new ProvisionWorkspaceFormDraft()
	const {
		isLoading: isProvisioningWorkspace,
		error: provisionWorkspaceError,
		execute: provisionWorkspace,
		reset: resetProvisionWorkspace,
	} = useApiAction(async () => {
		const response = await authState.provisionDefaultWorkspace(provisionWorkspaceForm.toModel())
		toasts.success({ title: 'Workspace created and Portfolio selected.' })
		await options.onSuccess?.(response)
		return response
	})

	return { provisionWorkspaceForm, isProvisioningWorkspace, provisionWorkspaceError, provisionWorkspace, resetProvisionWorkspace }
}

export function usePortfolioSelection(options: PortfolioSelectionOptions = {}) {
	const authState = useAuthState()
	const toasts = useToasts()
	const selectingPortfolioKey = ref('')
	const {
		isLoading: isSelectingPortfolio,
		error: selectPortfolioError,
		execute: executeSelectPortfolio,
		reset: resetSelectPortfolio,
	} = useApiAction(async (workspaceId: string, portfolioId: string) => {
		const selection = await authState.setSelection(workspaceId, portfolioId)
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

export function useSelectionClear() {
	const authState = useAuthState()
	const toasts = useToasts()
	const {
		isLoading: isClearingSelection,
		error: clearSelectionError,
		execute: clearSelection,
		reset: resetClearSelection,
	} = useApiAction(async () => {
		await authState.clearSelection()
		toasts.info({ title: 'Selection cleared.' })
	})

	return { isClearingSelection, clearSelectionError, clearSelection, resetClearSelection }
}

export function useLogoutAction() {
	const authState = useAuthState()
	const {
		isLoading: isLoggingOut,
		error: logoutError,
		execute: logout,
		reset: resetLogout,
	} = useApiAction(async () => {
		await authState.logout()
	})

	return { isLoggingOut, logoutError, logout, resetLogout }
}

function portfolioActionKey(workspaceId: string, portfolioId: string): string {
	return `${workspaceId}:${portfolioId}`
}
