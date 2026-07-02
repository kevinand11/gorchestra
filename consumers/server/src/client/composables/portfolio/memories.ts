import { computed, watch, type Ref } from 'vue'

import { MemoryCreationFormDraft, MemoryRevisionFormDraft } from '../../forms/memory'
import { useApiAction, useFetchAction } from '../action-state'
import { useQueryCache } from '../query-cache'
import { useSelectedPortfolio } from '../selected-portfolio'
import { useToasts } from '../toasts'
import { useServerApi, type ServerApi } from '../useServerApi'

type MemoryParentIdRef = Readonly<Ref<string | null>>
export type ListedMemory = Awaited<ReturnType<ServerApi['listMemoryChildren']>>[number]
export type MemoryDetails = Awaited<ReturnType<ServerApi['getMemory']>>
type CreatedMemory = Awaited<ReturnType<ServerApi['createMemory']>>

type MemoryCreateOptions = {
	onSuccess?: (memory: CreatedMemory) => void | Promise<void>
}

type MemoryRevisionCreateOptions = {
	onSuccess?: (memory: MemoryDetails) => void | Promise<void>
}

type QueryCacheAccess = ReturnType<typeof useQueryCache>

export function useMemoryChildren(parentId: MemoryParentIdRef) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: memories,
		isLoading: isLoadingMemories,
		error: memoriesError,
		hasExecuted: hasLoadedMemories,
		execute: refreshMemories,
		reset: resetMemories,
	} = useFetchAction(() => serverApi.listMemoryChildren(parentId.value), {
		queryKey: queryKeys.portfolio.memories(portfolio.value.id, memoryParentScope(parentId.value)),
		initialData: [] as ListedMemory[],
	})
	const isRefreshingMemories = computed(() => isLoadingMemories.value && hasLoadedMemories.value)

	return { memories, isLoadingMemories, memoriesError, hasLoadedMemories, isRefreshingMemories, refreshMemories, resetMemories }
}

export function useMemoryDetail(memoryId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: memory,
		isLoading: isLoadingMemory,
		error: memoryError,
		hasExecuted: hasLoadedMemory,
		execute: refreshMemory,
		reset: resetMemory,
	} = useFetchAction(() => serverApi.getMemory(memoryId.value), {
		queryKey: queryKeys.portfolio.memory(portfolio.value.id, memoryId.value),
		initialData: null as MemoryDetails | null,
	})
	const isRefreshingMemory = computed(() => isLoadingMemory.value && hasLoadedMemory.value)

	return { memory, isLoadingMemory, memoryError, hasLoadedMemory, isRefreshingMemory, refreshMemory, resetMemory }
}

export function useMemoryCreate(parentId: MemoryParentIdRef, options: MemoryCreateOptions = {}) {
	const serverApi = useServerApi()
	const toasts = useToasts()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const memoryCreationForm = new MemoryCreationFormDraft(parentId.value)
	const {
		isLoading: isCreatingMemory,
		error: createMemoryError,
		execute: createMemory,
		reset: resetCreateMemory,
	} = useApiAction(async () => {
		const memory = await serverApi.createMemory(memoryCreationForm.toModel())
		invalidateMemoryContainer(queryCache, portfolio.value.id, memory.parentId)
		memoryCreationForm.reset()
		toasts.success({ title: 'Memory created.', body: memory.currentRevision.title })
		await options.onSuccess?.(memory)
		return memory
	})

	watch(parentId, (nextParentId) => {
		memoryCreationForm.parentId = nextParentId
		memoryCreationForm.reset()
	})

	return { memoryCreationForm, isCreatingMemory, createMemoryError, createMemory, resetCreateMemory }
}

export function useMemoryRevisionCreate(memoryId: Ref<string>, options: MemoryRevisionCreateOptions = {}) {
	const serverApi = useServerApi()
	const toasts = useToasts()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const memoryRevisionForm = new MemoryRevisionFormDraft()
	const {
		isLoading: isSavingRevision,
		error: saveRevisionError,
		execute: saveRevision,
		reset: resetSaveRevision,
	} = useApiAction(async () => {
		const updatedMemory = await serverApi.createMemoryRevision(memoryId.value, memoryRevisionForm.toModel())
		const updatedDetails = await serverApi.getMemory(updatedMemory.id)
		queryCache.set(queryCache.queryKeys.portfolio.memory(portfolio.value.id, updatedDetails.id), updatedDetails)
		invalidateMemoryContainer(queryCache, portfolio.value.id, updatedDetails.parentId)
		toasts.success({ title: 'Memory revised.', body: updatedDetails.currentRevision.title })
		await options.onSuccess?.(updatedDetails)
		return updatedDetails
	})

	return { memoryRevisionForm, isSavingRevision, saveRevisionError, saveRevision, resetSaveRevision }
}

function invalidateMemoryContainer(queryCache: QueryCacheAccess, portfolioId: string, parentId: string | null): void {
	if (parentId === null) {
		queryCache.invalidate(queryCache.queryKeys.portfolio.memories(portfolioId, 'root'), { exact: true })
		return
	}

	queryCache.invalidate(queryCache.queryKeys.portfolio.memory(portfolioId, parentId), { exact: true })
}

function memoryParentScope(parentId: string | null): string {
	return parentId ?? 'root'
}
