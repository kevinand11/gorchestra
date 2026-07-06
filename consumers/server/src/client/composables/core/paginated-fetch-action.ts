import { addToArray } from 'valleyed'
import { computed } from 'vue'

import { useApiAction, useFetchAction } from './action-state'
import { useQueryCache, type QueryKeyInput } from './query-cache'

export type PaginatedFetchInput = { beforeId?: string; limit?: number; page?: number }
export type PaginatedFetchEnvelope<TItem> = {
	items: TItem[]
	pages: { current: number; start: number; last: number; previous: number | null; next: number | null }
	docs: { limit: number; total: number; count: number }
}

type PaginatedItem = { id: string }
type PaginatedFetchState<TItem extends PaginatedItem> = { items: TItem[]; hasNext: boolean }
type PaginatedFetcher<TItem extends PaginatedItem> = (input: PaginatedFetchInput) => Promise<PaginatedFetchEnvelope<TItem>>

type PaginatedFetchActionOptions = {
	queryKey: QueryKeyInput
	limit?: number
	immediate?: boolean
}

const defaultPaginatedFetchLimit = 50

export function usePaginatedFetchAction<TItem extends PaginatedItem>(
	fetcher: PaginatedFetcher<TItem>,
	options: PaginatedFetchActionOptions,
) {
	const queryCache = useQueryCache()
	const limit = options.limit ?? defaultPaginatedFetchLimit
	const initial = useFetchAction(() => fetchInitialPage(fetcher, limit), {
		queryKey: options.queryKey,
		initialData: { items: [] as TItem[], hasNext: false },
		immediate: options.immediate,
	})
	const items = computed(() => initial.data.value.items)
	const hasNext = computed(() => initial.data.value.hasNext)
	const next = useApiAction(async () => {
		const current = initial.data.value
		const beforeId = current.items.at(-1)?.id
		if (beforeId === undefined) return

		const page = await fetcher({ beforeId, limit })
		queryCache.set(resolveQueryKey(options.queryKey), {
			items: appendItems(current.items, page.items),
			hasNext: page.pages.next !== null,
		})
	})

	async function fetchNext(): Promise<void> {
		if (initial.isLoading.value || next.isLoading.value || !hasNext.value) return
		await next.execute()
	}

	return {
		items,
		hasNext,
		isLoading: computed(() => initial.isLoading.value || next.isLoading.value),
		error: computed(() => initial.error.value || next.error.value),
		hasExecuted: computed(() => initial.hasExecuted.value || next.hasExecuted.value),
		fetchNext,
	}
}

async function fetchInitialPage<TItem extends PaginatedItem>(
	fetcher: PaginatedFetcher<TItem>,
	limit: number,
): Promise<PaginatedFetchState<TItem>> {
	const page = await fetcher({ limit })
	return { items: appendItems([], page.items), hasNext: page.pages.next !== null }
}

function appendItems<TItem extends PaginatedItem>(existing: readonly TItem[], fetched: readonly TItem[]): TItem[] {
	const items = [...existing]
	for (const item of fetched)
		addToArray(
			items,
			item,
			(value) => value.id,
			(value) => value.id,
		)
	return items
}

function resolveQueryKey(queryKey: QueryKeyInput): readonly string[] {
	return typeof queryKey === 'function' ? queryKey() : queryKey
}
