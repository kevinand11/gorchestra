import { isRef, readonly, ref, shallowRef, type Ref } from '@vue/reactivity'

type QueryKey = readonly string[]

type QueryMatchOptions = {
	exact?: boolean
}

type QueryInitialData<T> = T | (() => T)

type QueryObserver<T> = {
	queryKey: QueryKey
	initialData: QueryInitialData<T>
	data: Ref<T>
	isLoading: Ref<boolean>
	error: Ref<string>
	hasExecuted: Ref<boolean>
	immediate: boolean
	fetcher: () => Promise<T>
}

type SerializedQueryEntry = {
	key: string[]
	data?: unknown
	hasData: boolean
	invalidated: boolean
	version: number
}

type QueryCacheSnapshot = Record<string, SerializedQueryEntry>

type RuntimeQueryEntry = {
	observers: Set<QueryObserver<unknown>>
	inFlight: Promise<unknown> | null
	inFlightVersion: number
}

const queryCacheRuntimeKey = Symbol('gorchestra.query-cache.runtime')
const queryCacheStateKey = 'gorchestra.query-cache.snapshot'

type NuxtAppWithQueryCache = ReturnType<typeof useNuxtApp> & {
	[queryCacheRuntimeKey]?: ReturnType<typeof createQueryCacheController>
}

const queryKeys = {
	workspacePortfolios(): QueryKey {
		return ['workspace-portfolios']
	},
	portfolio: {
		root(portfolioId: string): QueryKey {
			return ['portfolio', portfolioId]
		},
		projects(portfolioId: string): QueryKey {
			return ['portfolio', portfolioId, 'projects']
		},
		project(portfolioId: string, projectId: string): QueryKey {
			return ['portfolio', portfolioId, 'projects', projectId]
		},
		repositories(portfolioId: string, projectId: string): QueryKey {
			return ['portfolio', portfolioId, 'projects', projectId, 'repositories']
		},
		repository(portfolioId: string, projectId: string, repositoryId: string): QueryKey {
			return ['portfolio', portfolioId, 'projects', projectId, 'repositories', repositoryId]
		},
		secrets(portfolioId: string): QueryKey {
			return ['portfolio', portfolioId, 'secrets']
		},
		secret(portfolioId: string, secretId: string): QueryKey {
			return ['portfolio', portfolioId, 'secrets', secretId]
		},
	},
} as const

export function useQueryCache() {
	const controller = useQueryCacheControllerForFetch()
	return { invalidate: controller.invalidate, clear: controller.clear, queryKeys }
}

export function useQueryCacheControllerForFetch() {
	const nuxtApp = tryUseNuxtApp()
	if (nuxtApp === null) throw new Error('Query Cache requires an active Nuxt app context')

	const appWithQueryCache = nuxtApp as NuxtAppWithQueryCache
	appWithQueryCache[queryCacheRuntimeKey] ??= createQueryCacheController(
		useState<QueryCacheSnapshot>(queryCacheStateKey, createEmptyQueryCacheSnapshot),
	)
	return appWithQueryCache[queryCacheRuntimeKey]
}

function createEmptyQueryCacheSnapshot(): QueryCacheSnapshot {
	return {}
}

function createQueryCacheController(snapshot: Ref<QueryCacheSnapshot> | QueryCacheSnapshot) {
	const snapshotRef = isRef(snapshot) ? snapshot : ref(snapshot)
	const runtimeEntries = new Map<string, RuntimeQueryEntry>()
	const clearedVersions = new Map<string, number>()

	function attach<T>(observer: QueryObserver<T>): () => void {
		const id = serializeQueryKey(observer.queryKey)
		const runtime = getRuntimeEntry(id)
		runtime.observers.add(observer)
		applySnapshotToObserver(observer)
		return () => {
			runtime.observers.delete(observer)
		}
	}

	async function ensure<T>(observer: QueryObserver<T>): Promise<T> {
		const entry = getSnapshotEntry(observer.queryKey)
		if (hasFreshData(entry)) return applyFreshData(observer, entry)
		if (isUnexecutedLazyObserver(observer)) return observer.data.value
		return await runFetch(observer, entry.version, !entry.hasData)
	}

	async function refetch<T>(observer: QueryObserver<T>): Promise<T> {
		const entry = getSnapshotEntry(observer.queryKey)
		entry.invalidated = true
		entry.version += 1
		return await runFetch(observer, entry.version, true)
	}

	function invalidate(queryKey: QueryKey, options: QueryMatchOptions = {}): void {
		for (const entry of matchingEntries(queryKey, options)) refetchInvalidatedEntry(markInvalidated(entry))
	}

	function clear(queryKey: QueryKey, options: QueryMatchOptions = {}): void {
		for (const entry of matchingEntries(queryKey, options)) {
			const id = serializeQueryKey(entry.key)
			clearedVersions.set(id, entry.version)
			delete snapshotRef.value[id]
			const runtime = runtimeEntries.get(id)
			if (runtime === undefined) continue
			runtime.inFlight = null
			for (const observer of runtime.observers) resetObserverToInitialData(observer)
		}
	}

	function getSnapshotEntry(queryKey: QueryKey): SerializedQueryEntry {
		const id = serializeQueryKey(queryKey)
		snapshotRef.value[id] ??= {
			key: [...queryKey],
			hasData: false,
			invalidated: false,
			version: getInitialVersionAfterClear(id),
		}
		return snapshotRef.value[id]
	}

	function getInitialVersionAfterClear(id: string): number {
		return (clearedVersions.get(id) ?? -1) + 1
	}

	function getRuntimeEntry(id: string): RuntimeQueryEntry {
		let entry = runtimeEntries.get(id)
		if (entry === undefined) {
			entry = { observers: new Set(), inFlight: null, inFlightVersion: 0 }
			runtimeEntries.set(id, entry)
		}
		return entry
	}

	function matchingEntries(queryKey: QueryKey, options: QueryMatchOptions): SerializedQueryEntry[] {
		return Object.values(snapshotRef.value).filter((entry) => matchesQueryKey(entry.key, queryKey, options))
	}

	function hasFreshData(entry: SerializedQueryEntry): boolean {
		return entry.hasData && !entry.invalidated
	}

	function applyFreshData<T>(observer: QueryObserver<T>, entry: SerializedQueryEntry): T {
		applySnapshotToObserver(observer)
		return entry.data as T
	}

	function isUnexecutedLazyObserver(observer: QueryObserver<unknown>): boolean {
		return !observer.immediate && !observer.hasExecuted.value
	}

	function markInvalidated(entry: SerializedQueryEntry): SerializedQueryEntry {
		entry.invalidated = true
		entry.version += 1
		return entry
	}

	function refetchInvalidatedEntry(entry: SerializedQueryEntry): void {
		const runtime = runtimeEntries.get(serializeQueryKey(entry.key))
		const fetchObserver = [...(runtime?.observers ?? [])].find(canRefetchAfterInvalidation)
		if (fetchObserver === undefined) return
		setObserversLoading(runtime, true)
		void runFetch(fetchObserver, entry.version, false).catch(() => {})
	}

	function canRefetchAfterInvalidation(observer: QueryObserver<unknown>): boolean {
		return observer.immediate || observer.hasExecuted.value
	}

	async function runFetch<T>(observer: QueryObserver<T>, version: number, rejectOnError: boolean): Promise<T> {
		const id = serializeQueryKey(observer.queryKey)
		const runtime = getRuntimeEntry(id)
		if (runtime.inFlight !== null && runtime.inFlightVersion === version) {
			return await resolveInFlight(observer, runtime.inFlight, rejectOnError)
		}

		setObserversLoading(runtime, true)
		const current = runFreshFetch(observer, id, version)
		runtime.inFlight = current
		runtime.inFlightVersion = version
		try {
			return await resolveInFlight(observer, current, rejectOnError)
		} finally {
			if (runtime.inFlight === current) runtime.inFlight = null
		}
	}

	async function resolveInFlight<T>(observer: QueryObserver<T>, inFlight: Promise<unknown>, rejectOnError: boolean): Promise<T> {
		try {
			return (await inFlight) as T
		} catch (error) {
			if (rejectOnError || !getSnapshotEntry(observer.queryKey).hasData) throw error
			return observer.data.value
		}
	}

	async function runFreshFetch<T>(observer: QueryObserver<T>, id: string, version: number): Promise<T> {
		try {
			return handleFetchSuccess(id, version, await observer.fetcher())
		} catch (error) {
			return handleFetchFailure(observer, id, version, error)
		} finally {
			finishFetchIfCurrent(id, version)
		}
	}

	function handleFetchSuccess<T>(id: string, version: number, result: T): T {
		const entry = snapshotRef.value[id]
		if (!isCurrentEntry(entry, version)) return result
		entry.data = result
		entry.hasData = true
		entry.invalidated = false
		for (const currentObserver of getRuntimeEntry(id).observers) applySnapshotToObserver(currentObserver)
		return result
	}

	function handleFetchFailure<T>(observer: QueryObserver<T>, id: string, version: number, error: unknown): T {
		const entry = snapshotRef.value[id]
		if (!isCurrentEntry(entry, version)) return observer.data.value
		applyFailureToObservers(id, getQueryErrorMessage(error))
		throw error
	}

	function finishFetchIfCurrent(id: string, version: number): void {
		if (isCurrentEntry(snapshotRef.value[id], version)) setObserversLoading(getRuntimeEntry(id), false)
	}

	function isCurrentEntry(entry: SerializedQueryEntry | undefined, version: number): entry is SerializedQueryEntry {
		return entry !== undefined && entry.version === version
	}

	function applyFailureToObservers(id: string, message: string): void {
		for (const currentObserver of getRuntimeEntry(id).observers) {
			currentObserver.hasExecuted.value = true
			currentObserver.error.value = message
			currentObserver.isLoading.value = false
		}
	}

	function applySnapshotToObserver<T>(observer: QueryObserver<T>): void {
		const id = serializeQueryKey(observer.queryKey)
		const entry = snapshotRef.value[id]
		if (entry?.hasData !== true) return
		observer.data.value = entry.data as T
		observer.hasExecuted.value = true
		observer.error.value = ''
		observer.isLoading.value = false
	}

	function resetObserverToInitialData<T>(observer: QueryObserver<T>): void {
		observer.data.value = resolveInitialData(observer.initialData)
		observer.isLoading.value = false
		observer.error.value = ''
		observer.hasExecuted.value = false
	}

	function setObserversLoading(runtime: RuntimeQueryEntry | undefined, loading: boolean): void {
		if (runtime === undefined) return
		for (const observer of runtime.observers) {
			observer.isLoading.value = loading
			if (loading) observer.error.value = ''
		}
	}

	return { attach, ensure, refetch, invalidate, clear, snapshot: readonly(snapshotRef) }
}

function matchesQueryKey(candidate: QueryKey, target: QueryKey, options: QueryMatchOptions = {}): boolean {
	if (options.exact === true && candidate.length !== target.length) return false
	if (target.length > candidate.length) return false
	return target.every((segment, index) => candidate[index] === segment)
}

function serializeQueryKey(queryKey: QueryKey): string {
	return JSON.stringify(queryKey)
}

function resolveInitialData<T>(initialData: QueryInitialData<T>): T {
	return typeof initialData === 'function' ? (initialData as () => T)() : initialData
}

function getQueryErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return getObjectErrorMessage(error) ?? String(error)
}

function getObjectErrorMessage(error: unknown): string | null {
	return hasMessage(error) ? String(error.message) : null
}

function hasMessage(error: unknown): error is { message: unknown } {
	return typeof error === 'object' && error !== null && 'message' in error
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Query Key helpers', () => {
		it('builds collection-style Portfolio Query Keys', () => {
			expect(queryKeys.workspacePortfolios()).toEqual(['workspace-portfolios'])
			expect(queryKeys.portfolio.root('portfolio-1')).toEqual(['portfolio', 'portfolio-1'])
			expect(queryKeys.portfolio.projects('portfolio-1')).toEqual(['portfolio', 'portfolio-1', 'projects'])
			expect(queryKeys.portfolio.project('portfolio-1', 'project-1')).toEqual(['portfolio', 'portfolio-1', 'projects', 'project-1'])
			expect(queryKeys.portfolio.repository('portfolio-1', 'project-1', 'repository-1')).toEqual([
				'portfolio',
				'portfolio-1',
				'projects',
				'project-1',
				'repositories',
				'repository-1',
			])
			expect(queryKeys.portfolio.secret('portfolio-1', 'secret-1')).toEqual(['portfolio', 'portfolio-1', 'secrets', 'secret-1'])
		})
	})

	describe('Query Key matching', () => {
		it('uses prefix matching by default', () => {
			expect(matchesQueryKey(['portfolio', 'p1', 'projects'], ['portfolio', 'p1'])).toBe(true)
			expect(matchesQueryKey(['portfolio', 'p1', 'projects', 'project-1'], ['portfolio', 'p1', 'projects'])).toBe(true)
			expect(matchesQueryKey(['portfolio', 'p2', 'projects'], ['portfolio', 'p1'])).toBe(false)
		})

		it('supports exact matching', () => {
			expect(matchesQueryKey(['portfolio', 'p1', 'projects'], ['portfolio', 'p1', 'projects'], { exact: true })).toBe(true)
			expect(matchesQueryKey(['portfolio', 'p1', 'projects', 'project-1'], ['portfolio', 'p1', 'projects'], { exact: true })).toBe(
				false,
			)
		})
	})

	describe('Query initial data', () => {
		it('resolves values and factories', () => {
			expect(resolveInitialData([] as string[])).toEqual([])
			expect(resolveInitialData(() => ['project-1'])).toEqual(['project-1'])
		})
	})

	describe('Query Cache core', () => {
		it('serves cached data to later observers without refetching', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			let calls = 0
			const first = createTestObserver(['workspace-portfolios'], [] as string[], () => {
				calls += 1
				return Promise.resolve(['workspace-1'])
			})
			cache.attach(first)
			await cache.ensure(first)

			const second = createTestObserver(['workspace-portfolios'], [] as string[], () => {
				calls += 1
				return Promise.resolve(['workspace-2'])
			})
			cache.attach(second)
			await cache.ensure(second)

			expect(calls).toBe(1)
			expect(second.data.value).toEqual(['workspace-1'])
			expect(second.hasExecuted.value).toBe(true)
		})

		it('invalidates by prefix and refetches active observers stale-while-refetch', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			let resolveFetch: (value: string[]) => void = () => {}
			const observer = createTestObserver(
				['portfolio', 'p1', 'projects'],
				[] as string[],
				() =>
					new Promise<string[]>((resolve) => {
						resolveFetch = resolve
					}),
			)
			cache.attach(observer)
			void cache.ensure(observer)
			resolveFetch(['old'])
			await flushPromises()

			const refetch = deferred<string[]>()
			observer.fetcher = () => refetch.promise
			cache.invalidate(['portfolio', 'p1'])

			expect(observer.data.value).toEqual(['old'])
			expect(observer.isLoading.value).toBe(true)
			expect(observer.hasExecuted.value).toBe(true)

			refetch.resolve(['new'])
			await flushPromises()

			expect(observer.data.value).toEqual(['new'])
			expect(observer.isLoading.value).toBe(false)
			expect(observer.error.value).toBe('')
		})

		it('clears matching entries without refetching active observers', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			let calls = 0
			const observer = createTestObserver(['portfolio', 'p1', 'projects'], [] as string[], () => {
				calls += 1
				return Promise.resolve(['project-1'])
			})
			cache.attach(observer)
			await cache.ensure(observer)

			cache.clear(['portfolio'])

			expect(calls).toBe(1)
			expect(observer.data.value).toEqual([])
			expect(observer.hasExecuted.value).toBe(false)
			expect(observer.isLoading.value).toBe(false)
		})

		it('ignores older in-flight results after invalidation starts a newer fetch', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			const oldFetch = deferred<string[]>()
			const newFetch = deferred<string[]>()
			const fetches = [oldFetch.promise, newFetch.promise]
			const observer = createTestObserver(
				['portfolio', 'p1', 'projects'],
				[] as string[],
				() => fetches.shift() ?? Promise.resolve(['fallback']),
			)
			cache.attach(observer)
			void cache.ensure(observer)
			cache.invalidate(['portfolio', 'p1', 'projects'], { exact: true })

			oldFetch.resolve(['old'])
			await flushPromises()
			expect(observer.data.value).toEqual([])
			expect(observer.isLoading.value).toBe(true)

			newFetch.resolve(['new'])
			await flushPromises()
			expect(observer.data.value).toEqual(['new'])
		})

		it('ignores pre-clear in-flight results after the same key is recreated', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			const oldFetch = deferred<string[]>()
			const observer = createTestObserver(['portfolio', 'p1', 'projects'], [] as string[], () => oldFetch.promise)
			cache.attach(observer)
			void cache.ensure(observer)
			cache.clear(['portfolio'])

			observer.fetcher = () => Promise.resolve(['new'])
			await cache.ensure(observer)
			oldFetch.resolve(['old'])
			await flushPromises()

			expect(observer.data.value).toEqual(['new'])
		})

		it('keeps stale data and records local errors after background refetch failures', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			const observer = createTestObserver(['portfolio', 'p1', 'projects'], [] as string[], () => Promise.resolve(['old']))
			cache.attach(observer)
			await cache.ensure(observer)

			observer.fetcher = () => Promise.reject(new Error('refetch failed'))
			cache.invalidate(['portfolio', 'p1', 'projects'], { exact: true })
			await flushPromises()

			expect(observer.data.value).toEqual(['old'])
			expect(observer.error.value).toBe('refetch failed')
			expect(observer.isLoading.value).toBe(false)
		})

		it('rejects manual refetch failures while keeping stale data visible', async () => {
			const cache = createQueryCacheController(createEmptyQueryCacheSnapshot())
			const observer = createTestObserver(['portfolio', 'p1', 'projects'], [] as string[], () => Promise.resolve(['old']))
			cache.attach(observer)
			await cache.ensure(observer)

			observer.fetcher = () => Promise.reject(new Error('manual failed'))

			await expect(cache.refetch(observer)).rejects.toThrow('manual failed')
			expect(observer.data.value).toEqual(['old'])
			expect(observer.error.value).toBe('manual failed')
		})
	})

	function createTestObserver<T>(queryKey: QueryKey, initialData: QueryInitialData<T>, fetcher: () => Promise<T>): QueryObserver<T> {
		return {
			queryKey,
			initialData,
			data: shallowRef(resolveInitialData(initialData)),
			isLoading: ref(false),
			error: ref(''),
			hasExecuted: ref(false),
			immediate: true,
			fetcher,
		}
	}

	function deferred<T>() {
		let resolve!: (value: T) => void
		let reject!: (error: unknown) => void
		const promise = new Promise<T>((promiseResolve, promiseReject) => {
			resolve = promiseResolve
			reject = promiseReject
		})
		return { promise, resolve, reject }
	}

	async function flushPromises(): Promise<void> {
		await Promise.resolve()
		await Promise.resolve()
	}
}
