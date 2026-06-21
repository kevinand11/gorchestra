export type ActionExecutionResult<T> = { success: true; result: T } | { success: false }

type Awaitable<T> = T | Promise<T>

type ActionStateOptions = {
	dedupeKey?: string
}

type FetchActionOptions = ActionStateOptions & {
	immediate?: boolean
}

const inFlightExecutions = new Map<string, Promise<unknown>>()

export function useApiAction<TArgs extends unknown[], TResult>(
	action: (...args: TArgs) => Awaitable<TResult>,
	options: ActionStateOptions = {},
) {
	const state = createActionState()

	async function execute(...args: TArgs): Promise<ActionExecutionResult<Awaited<TResult>>> {
		return await runWithOptionalInFlightDedupe(options.dedupeKey, async () => {
			startExecution(state)
			try {
				const result = await action(...args)
				finishSuccess(state)
				return { success: true, result }
			} catch (error) {
				finishLocalFailure(state, error)
				return { success: false }
			}
		})
	}

	return { ...state, execute, reset: () => resetActionState(state) }
}

export function useFetchAction<TResult>(action: () => Awaitable<TResult>, options: FetchActionOptions = {}) {
	const state = createActionState()

	async function execute(): Promise<Awaited<TResult>> {
		return await runWithOptionalInFlightDedupe(options.dedupeKey, async () => {
			startExecution(state)
			try {
				const result = await action()
				finishSuccess(state)
				return result
			} catch (error) {
				finishThrowingFailure(state, error)
			}
		})
	}

	if (options.immediate !== false) {
		onServerPrefetch(execute)
		onMounted(execute)
	}

	return { ...state, execute, reset: () => resetActionState(state) }
}

type ActionState = ReturnType<typeof createActionState>

function createActionState() {
	const isLoading = ref(false)
	const error = ref('')
	const hasExecuted = ref(false)
	return { isLoading, error, hasExecuted }
}

function startExecution(state: ActionState): void {
	state.isLoading.value = true
	state.error.value = ''
}

function finishSuccess(state: ActionState): void {
	state.hasExecuted.value = true
	state.isLoading.value = false
}

function finishLocalFailure(state: ActionState, error: unknown): void {
	state.hasExecuted.value = true
	state.error.value = getErrorMessage(error)
	state.isLoading.value = false
}

function finishThrowingFailure(state: ActionState, error: unknown): never {
	finishLocalFailure(state, error)
	throw error
}

function resetActionState(state: ActionState): void {
	state.isLoading.value = false
	state.error.value = ''
	state.hasExecuted.value = false
}

function getErrorMessage(error: unknown): string {
	return getHttpErrorMessages(error) ?? getFallbackErrorMessage(error)
}

function getHttpErrorMessages(error: unknown): string | null {
	const data = getNestedData(error, ['response', 'data'])
	return Array.isArray(data) ? data.map(getFallbackErrorMessage).join('\n') : null
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

async function runWithOptionalInFlightDedupe<T>(dedupeKey: string | undefined, execute: () => Promise<T>): Promise<T> {
	if (dedupeKey === undefined) return await execute()

	const existing = inFlightExecutions.get(dedupeKey) as Promise<T> | undefined
	if (existing !== undefined) return await existing

	const current = execute().finally(() => {
		inFlightExecutions.delete(dedupeKey)
	})
	inFlightExecutions.set(dedupeKey, current)
	return await current
}
