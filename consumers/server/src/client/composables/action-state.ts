import { onScopeDispose, onServerPrefetch, ref, shallowRef, type Ref } from 'vue'

import { useQueryCacheControllerForFetch } from './query-cache'

type ActionExecutionResult<T> = { success: true; result: T } | { success: false }

type Awaitable<T> = T | Promise<T>

type ActionStateOptions = {
	dedupeKey?: string
}

type FetchActionOptions<TData> = {
	queryKey: readonly string[]
	initialData: TData | (() => TData)
	immediate?: boolean
}

const inFlightExecutionsKey = Symbol('gorchestra.action-state.in-flight-executions')

type NuxtAppWithActionState = ReturnType<typeof useNuxtApp> & {
	[inFlightExecutionsKey]?: Map<string, Promise<unknown>>
}

export function useApiAction<TArgs extends unknown[], TResult>(
	action: (...args: TArgs) => Awaitable<TResult>,
	options: ActionStateOptions = {},
) {
	const state = createActionState()
	const executionController = createExecutionController()
	const inFlightExecutions = getScopedInFlightExecutions()

	async function execute(...args: TArgs): Promise<ActionExecutionResult<Awaited<TResult>>> {
		const executionId = startExecution(state, executionController)
		try {
			const result = await runWithOptionalInFlightDedupe(inFlightExecutions, options.dedupeKey, async () => await action(...args))
			finishSuccess(state, executionController, executionId)
			return { success: true, result }
		} catch (error) {
			finishLocalFailure(state, executionController, executionId, error)
			return { success: false }
		}
	}

	return { ...state, execute, reset: () => resetActionState(state, executionController) }
}

export function useFetchAction<TResult, TData = Awaited<TResult>>(action: () => Awaitable<TResult>, options: FetchActionOptions<TData>) {
	const state = createActionState()
	const controller = useQueryCacheControllerForFetch()
	const data = shallowRef(resolveInitialData(options.initialData)) as Ref<TData>
	const observer = {
		queryKey: options.queryKey,
		initialData: options.initialData,
		data,
		isLoading: state.isLoading,
		error: state.error,
		hasExecuted: state.hasExecuted,
		immediate: options.immediate !== false,
		fetcher: async () => (await action()) as TData,
	}
	const detach = controller.attach(observer)
	onScopeDispose(detach)

	async function execute(): Promise<TData> {
		return await controller.refetch(observer)
	}

	if (options.immediate !== false) {
		runImmediateFetch(async () => {
			await controller.ensure(observer)
		})
	}

	return { ...state, data: computed(() => data.value), execute, reset: () => resetFetchActionState(state) }
}

type ActionState = ReturnType<typeof createActionState>
type ExecutionController = ReturnType<typeof createExecutionController>

function createActionState() {
	const isLoading = ref(false)
	const error = ref('')
	const hasExecuted = ref(false)
	return { isLoading, error, hasExecuted }
}

function createExecutionController() {
	let currentExecutionId = 0

	return {
		start(): number {
			currentExecutionId += 1
			return currentExecutionId
		},
		isCurrent(executionId: number): boolean {
			return executionId === currentExecutionId
		},
		invalidate(): void {
			currentExecutionId += 1
		},
	}
}

function startExecution(state: ActionState, executionController: ExecutionController): number {
	const executionId = executionController.start()
	state.isLoading.value = true
	state.error.value = ''
	return executionId
}

function finishSuccess(state: ActionState, executionController: ExecutionController, executionId: number): void {
	if (!executionController.isCurrent(executionId)) return
	state.hasExecuted.value = true
	state.isLoading.value = false
}

function finishLocalFailure(state: ActionState, executionController: ExecutionController, executionId: number, error: unknown): void {
	if (!executionController.isCurrent(executionId)) return
	state.hasExecuted.value = true
	state.error.value = getErrorMessage(error)
	state.isLoading.value = false
}

function resetActionState(state: ActionState, executionController: ExecutionController): void {
	state.isLoading.value = false
	state.error.value = ''
	state.hasExecuted.value = false
	executionController.invalidate()
}

function resetFetchActionState(state: ActionState): void {
	state.isLoading.value = false
	state.error.value = ''
}

function resolveInitialData<T>(initialData: T | (() => T)): T {
	return typeof initialData === 'function' ? (initialData as () => T)() : initialData
}

function runImmediateFetch(execute: () => Promise<unknown>): void {
	if (typeof window === 'undefined') {
		onServerPrefetch(execute)
		return
	}

	if (useNuxtApp().isHydrating) return

	void execute().catch((error: unknown) => {
		reportFetchFailure(error)
	})
}

function reportFetchFailure(error: unknown): void {
	showError(error instanceof Error ? error : getErrorMessage(error))
}

function getErrorMessage(error: unknown): string {
	return getHttpErrorMessages(error) ?? getFallbackErrorMessage(error)
}

function getHttpErrorMessages(error: unknown): string | null {
	const data = getNestedData(error, ['response', 'data'])
	if (Array.isArray(data)) return joinErrorMessages(data)
	if (typeof data === 'string') return data
	return hasMessage(data) ? String(data.message) : null
}

function joinErrorMessages(errors: unknown[]): string {
	return errors.map(getFallbackErrorMessage).join('\n')
}

function getNestedData(source: unknown, path: string[]): unknown {
	return path.reduce<unknown>((value, key) => {
		if (typeof value !== 'object' || value === null || !(key in value)) return undefined
		return value[key as keyof typeof value]
	}, source)
}

function getFallbackErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return hasMessage(error) ? String(error.message) : String(error)
}

function hasMessage(error: unknown): error is { message: unknown } {
	return typeof error === 'object' && error !== null && 'message' in error
}

function getScopedInFlightExecutions(): Map<string, Promise<unknown>> {
	const nuxtApp = tryUseNuxtApp()
	if (nuxtApp === null) throw new Error('Action hooks require an active Nuxt app context')

	const appWithActionState = nuxtApp as NuxtAppWithActionState
	appWithActionState[inFlightExecutionsKey] ??= new Map<string, Promise<unknown>>()
	return appWithActionState[inFlightExecutionsKey]
}

async function runWithOptionalInFlightDedupe<T>(
	inFlightExecutions: Map<string, Promise<unknown>>,
	dedupeKey: string | undefined,
	execute: () => Promise<T>,
): Promise<T> {
	if (dedupeKey === undefined) return await execute()

	const existing = inFlightExecutions.get(dedupeKey) as Promise<T> | undefined
	if (existing !== undefined) return await existing

	const current = execute()
	inFlightExecutions.set(dedupeKey, current)
	try {
		return await current
	} finally {
		if (inFlightExecutions.get(dedupeKey) === current) inFlightExecutions.delete(dedupeKey)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('action state error messages', () => {
		it('extracts Equipped serialized error messages without field names', () => {
			expect(
				getErrorMessage({
					response: { data: [{ message: 'Invalid email', field: 'email' }, { message: 'Code expired' }] },
				}),
			).toBe('Invalid email\nCode expired')
		})

		it('extracts object and string HTTP response messages', () => {
			expect(getErrorMessage({ response: { data: { message: 'Not authenticated' } } })).toBe('Not authenticated')
			expect(getErrorMessage({ response: { data: 'plain failure' } })).toBe('plain failure')
		})

		it('falls back to thrown Error messages', () => {
			expect(getErrorMessage(new Error('fallback failure'))).toBe('fallback failure')
		})
	})

	describe('action state in-flight dedupe', () => {
		it('shares underlying work while preserving awaited results', async () => {
			const inFlight = new Map<string, Promise<unknown>>()
			let executions = 0
			const first = runWithOptionalInFlightDedupe(inFlight, 'same', () => {
				executions += 1
				return Promise.resolve('result')
			})
			const second = runWithOptionalInFlightDedupe(inFlight, 'same', () => {
				executions += 1
				return Promise.resolve('other')
			})

			await expect(Promise.all([first, second])).resolves.toEqual(['result', 'result'])
			expect(executions).toBe(1)
			expect(inFlight.size).toBe(0)
		})
	})

	describe('action state execution controller', () => {
		it('uses latest-started execution ownership and supports invalidation', () => {
			const controller = createExecutionController()
			const first = controller.start()
			const second = controller.start()

			expect(controller.isCurrent(first)).toBe(false)
			expect(controller.isCurrent(second)).toBe(true)
			controller.invalidate()
			expect(controller.isCurrent(second)).toBe(false)
		})
	})
}
