import { computed, ref, type ComputedRef, type Ref } from 'vue'

type OverlayToastKind = 'success' | 'error' | 'info'

type OverlayToastInput = {
	title: string
	body?: string
	durationMs?: number | null
}

type OverlayToastMessage = {
	id: string
	kind: OverlayToastKind
	title: string
	body?: string
}

type OverlayButtonVariant = 'primary' | 'secondary' | 'ghost'
type OverlayButtonTone = 'default' | 'danger'

type OverlayButtonInput = {
	label: string
	variant?: OverlayButtonVariant
	tone?: OverlayButtonTone
}

type OverlayButton = {
	label: string
	variant: OverlayButtonVariant
	tone: OverlayButtonTone
}

type OverlayConfirmInput = {
	title: string
	body?: string
	dismissible?: boolean
	confirm?: OverlayButtonInput
	cancel?: OverlayButtonInput
}

type OverlayPromptTextInput = {
	type: 'text'
	label?: string
	placeholder?: string
	initialValue?: string
	required?: boolean
	trim?: boolean
	requiredMessage?: string
}

type OverlayPromptTextareaInput = {
	type: 'textarea'
	label?: string
	placeholder?: string
	initialValue?: string
	required?: boolean
	trim?: boolean
	requiredMessage?: string
	rows?: number
}

type OverlayPromptInputConfig = OverlayPromptTextInput | OverlayPromptTextareaInput

type OverlayPromptInput = {
	title: string
	body?: string
	dismissible?: boolean
	input?: OverlayPromptInputConfig
	confirm?: OverlayButtonInput
	cancel?: OverlayButtonInput
}

type NormalizedPromptTextInput = Required<OverlayPromptTextInput>
type NormalizedPromptTextareaInput = Required<OverlayPromptTextareaInput>
type NormalizedPromptInputConfig = NormalizedPromptTextInput | NormalizedPromptTextareaInput

type OverlayConfirmRequest = {
	id: string
	type: 'confirm'
	title: string
	body?: string
	dismissible: boolean
	confirm: OverlayButton
	cancel: OverlayButton
}

type OverlayPromptRequest = {
	id: string
	type: 'prompt'
	title: string
	body?: string
	dismissible: boolean
	input: NormalizedPromptInputConfig
	confirm: OverlayButton
	cancel: OverlayButton
}

type OverlayRequest = OverlayConfirmRequest | OverlayPromptRequest
type OverlayResolveValue = boolean | string | null
type OverlayResolver = (value: OverlayResolveValue) => void

type OverlayToastSurface = {
	messages: ComputedRef<readonly OverlayToastMessage[]>
	success(input: OverlayToastInput): OverlayToastMessage
	error(input: OverlayToastInput): OverlayToastMessage
	info(input: OverlayToastInput): OverlayToastMessage
	dismiss(id: string): void
	clear(): void
}

type OverlayRuntimeState = {
	toasts: Ref<OverlayToastMessage[]>
	requests: Ref<OverlayRequest[]>
	resolvers: Map<string, OverlayResolver>
	toastTimers: Map<string, number>
	nextId: Ref<number>
}

const defaultToastDurationMs = 4000
const defaultRequiredPromptMessage = 'Enter a value.'
const defaultConfirmButton: OverlayButton = { label: 'Confirm', variant: 'primary', tone: 'default' }
const defaultSubmitButton: OverlayButton = { label: 'Submit', variant: 'primary', tone: 'default' }
const defaultCancelButton: OverlayButton = { label: 'Cancel', variant: 'ghost', tone: 'default' }
const defaultTextPromptInput: NormalizedPromptTextInput = {
	type: 'text',
	label: 'Value',
	placeholder: '',
	initialValue: '',
	required: true,
	trim: false,
	requiredMessage: defaultRequiredPromptMessage,
}
const defaultTextareaPromptInput: NormalizedPromptTextareaInput = {
	type: 'textarea',
	label: 'Value',
	placeholder: '',
	initialValue: '',
	required: true,
	trim: false,
	requiredMessage: defaultRequiredPromptMessage,
	rows: 4,
}
const overlayRuntimeKey = Symbol('gorchestra.overlay.runtime')

type NuxtAppWithOverlayRuntime = ReturnType<typeof useNuxtApp> & {
	[overlayRuntimeKey]?: OverlayRuntimeState
}

export function useOverlay() {
	const runtime = getOverlayRuntime()
	const toast = createToastSurface(runtime)

	return {
		toast,
		confirm: async (input: OverlayConfirmInput) => {
			assertBrowserOverlayAction()
			return await requestConfirmation(runtime, input)
		},
		prompt: async (input: OverlayPromptInput) => {
			assertBrowserOverlayAction()
			return await requestPrompt(runtime, input)
		},
	}
}

export function useOverlayShelf() {
	const runtime = getOverlayRuntime()
	const toast = createToastSurface(runtime)

	return {
		toast,
		requests: computed(() => runtime.requests.value),
		resolveRequest: (id: string, value: OverlayResolveValue) => resolveOverlayRequest(runtime, id, value),
		cancelAllRequests: () => cancelAllOverlayRequests(runtime),
	}
}

function getOverlayRuntime(): OverlayRuntimeState {
	const nuxtApp = tryUseNuxtApp()
	if (nuxtApp === null) throw new Error('Overlay composables require an active Nuxt app context')

	const appWithOverlayRuntime = nuxtApp as NuxtAppWithOverlayRuntime
	appWithOverlayRuntime[overlayRuntimeKey] ??= createOverlayRuntime()
	return appWithOverlayRuntime[overlayRuntimeKey]
}

function createOverlayRuntime(): OverlayRuntimeState {
	return {
		toasts: ref([]),
		requests: ref([]),
		resolvers: new Map(),
		toastTimers: new Map(),
		nextId: ref(0),
	}
}

function createToastSurface(runtime: OverlayRuntimeState): OverlayToastSurface {
	return {
		messages: computed(() => runtime.toasts.value),
		success: (input) => addToast(runtime, 'success', input),
		error: (input) => addToast(runtime, 'error', input),
		info: (input) => addToast(runtime, 'info', input),
		dismiss: (id) => dismissToast(runtime, id),
		clear: () => clearToasts(runtime),
	}
}

function addToast(runtime: OverlayRuntimeState, kind: OverlayToastKind, input: OverlayToastInput): OverlayToastMessage {
	assertBrowserOverlayAction()
	const toast: OverlayToastMessage = {
		id: nextOverlayId(runtime, 'toast'),
		kind,
		title: input.title,
		...(input.body === undefined ? {} : { body: input.body }),
	}
	runtime.toasts.value = [...runtime.toasts.value, toast]
	scheduleToastDismiss(runtime, toast.id, input.durationMs)
	return toast
}

function dismissToast(runtime: OverlayRuntimeState, id: string): void {
	clearToastTimer(runtime, id)
	runtime.toasts.value = runtime.toasts.value.filter((toast) => toast.id !== id)
}

function clearToasts(runtime: OverlayRuntimeState): void {
	for (const id of runtime.toastTimers.keys()) clearToastTimer(runtime, id)
	runtime.toasts.value = []
}

function scheduleToastDismiss(runtime: OverlayRuntimeState, id: string, durationMs: number | null | undefined): void {
	if (durationMs === null || typeof window === 'undefined') return
	const timer = window.setTimeout(() => dismissToast(runtime, id), durationMs ?? defaultToastDurationMs)
	runtime.toastTimers.set(id, timer)
}

function clearToastTimer(runtime: OverlayRuntimeState, id: string): void {
	const timer = runtime.toastTimers.get(id)
	if (timer === undefined) return
	if (typeof window !== 'undefined') window.clearTimeout(timer)
	runtime.toastTimers.delete(id)
}

function requestConfirmation(runtime: OverlayRuntimeState, input: OverlayConfirmInput): Promise<boolean> {
	const request = normalizeConfirmRequest(nextOverlayId(runtime, 'request'), input)
	return new Promise<boolean>((resolve) => {
		runtime.resolvers.set(request.id, (value) => resolve(value === true))
		runtime.requests.value = [...runtime.requests.value, request]
	})
}

function requestPrompt(runtime: OverlayRuntimeState, input: OverlayPromptInput): Promise<string | null> {
	const request = normalizePromptRequest(nextOverlayId(runtime, 'request'), input)
	return new Promise<string | null>((resolve) => {
		runtime.resolvers.set(request.id, (value) => resolve(typeof value === 'string' ? value : null))
		runtime.requests.value = [...runtime.requests.value, request]
	})
}

function resolveOverlayRequest(runtime: OverlayRuntimeState, id: string, value: OverlayResolveValue): void {
	const resolver = runtime.resolvers.get(id)
	if (resolver === undefined) return

	runtime.resolvers.delete(id)
	runtime.requests.value = runtime.requests.value.filter((request) => request.id !== id)
	resolver(value)
}

function cancelAllOverlayRequests(runtime: OverlayRuntimeState): void {
	const pending = runtime.requests.value.map((request) => ({ request, resolver: runtime.resolvers.get(request.id) }))
	runtime.requests.value = []
	runtime.resolvers.clear()
	pending.forEach(({ request, resolver }) => resolver?.(cancellationValue(request)))
}

function normalizeConfirmRequest(id: string, input: OverlayConfirmInput): OverlayConfirmRequest {
	return {
		id,
		type: 'confirm',
		title: input.title,
		...(input.body === undefined ? {} : { body: input.body }),
		dismissible: input.dismissible ?? true,
		confirm: normalizeButton(input.confirm, defaultConfirmButton),
		cancel: normalizeButton(input.cancel, defaultCancelButton),
	}
}

function normalizePromptRequest(id: string, input: OverlayPromptInput): OverlayPromptRequest {
	return {
		id,
		type: 'prompt',
		title: input.title,
		...(input.body === undefined ? {} : { body: input.body }),
		dismissible: input.dismissible ?? true,
		input: normalizePromptInput(input.input),
		confirm: normalizeButton(input.confirm, defaultSubmitButton),
		cancel: normalizeButton(input.cancel, defaultCancelButton),
	}
}

function normalizeButton(input: OverlayButtonInput | undefined, defaults: OverlayButton): OverlayButton {
	return input === undefined ? defaults : { ...defaults, ...input }
}

function normalizePromptInput(input: OverlayPromptInputConfig | undefined): NormalizedPromptInputConfig {
	return input !== undefined && input.type === 'textarea' ? normalizeTextareaPromptInput(input) : normalizeTextPromptInput(input)
}

function normalizeTextPromptInput(input: OverlayPromptTextInput | undefined): NormalizedPromptTextInput {
	return { ...defaultTextPromptInput, ...input, type: 'text' }
}

function normalizeTextareaPromptInput(input: OverlayPromptTextareaInput): NormalizedPromptTextareaInput {
	return { ...defaultTextareaPromptInput, ...input, type: 'textarea' }
}

function cancellationValue(request: OverlayRequest): OverlayResolveValue {
	return request.type === 'confirm' ? false : null
}

function nextOverlayId(runtime: OverlayRuntimeState, prefix: string): string {
	runtime.nextId.value += 1
	return `${prefix}-${runtime.nextId.value}`
}

function assertBrowserOverlayAction(): void {
	if (typeof window === 'undefined') throw new Error('Overlay actions require a browser')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('overlay requests', () => {
		it('resolves confirmations with boolean values and removes requests', async () => {
			const runtime = createOverlayRuntime()
			const confirmed = requestConfirmation(runtime, { title: 'Archive?' })
			const request = firstRequest(runtime)

			expect(request).toMatchObject({ type: 'confirm', title: 'Archive?' })
			resolveOverlayRequest(runtime, request.id, true)

			await expect(confirmed).resolves.toBe(true)
			expect(runtime.requests.value).toEqual([])
		})

		it('resolves prompts with submitted strings', async () => {
			const runtime = createOverlayRuntime()
			const submitted = requestPrompt(runtime, { title: 'Feedback', input: { type: 'textarea', rows: 6, trim: true } })
			const request = firstRequest(runtime)

			expect(request).toMatchObject({ type: 'prompt', input: { type: 'textarea', rows: 6, trim: true } })
			resolveOverlayRequest(runtime, request.id, 'Revise this')

			await expect(submitted).resolves.toBe('Revise this')
		})

		it('uses cancellation values for unresolved requests when clearing all requests', async () => {
			const runtime = createOverlayRuntime()
			const confirmed = requestConfirmation(runtime, { title: 'Confirm?' })
			const prompted = requestPrompt(runtime, { title: 'Prompt?' })

			cancelAllOverlayRequests(runtime)

			await expect(confirmed).resolves.toBe(false)
			await expect(prompted).resolves.toBeNull()
			expect(runtime.requests.value).toEqual([])
		})

		it('ignores requests that were already resolved', async () => {
			const runtime = createOverlayRuntime()
			const confirmed = requestConfirmation(runtime, { title: 'Confirm?' })
			const request = firstRequest(runtime)

			resolveOverlayRequest(runtime, request.id, true)
			resolveOverlayRequest(runtime, request.id, false)

			await expect(confirmed).resolves.toBe(true)
		})

		it('normalizes buttons and prompt input defaults', () => {
			expect(
				normalizePromptRequest('request-1', {
					title: 'Prompt',
					confirm: { label: 'Save', tone: 'danger' },
				}).input,
			).toEqual({
				type: 'text',
				label: 'Value',
				placeholder: '',
				initialValue: '',
				required: true,
				trim: false,
				requiredMessage: defaultRequiredPromptMessage,
			})
			expect(
				normalizePromptRequest('request-1', {
					title: 'Prompt',
					confirm: { label: 'Save', tone: 'danger' },
				}).confirm,
			).toEqual({ label: 'Save', variant: 'primary', tone: 'danger' })
		})

		function firstRequest(runtime: OverlayRuntimeState): OverlayRequest {
			const request = runtime.requests.value[0]
			if (request === undefined) throw new Error('Expected an overlay request')
			return request
		}
	})
}
