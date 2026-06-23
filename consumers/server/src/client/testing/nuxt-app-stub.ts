import { ref, type Ref } from 'vue'

type NuxtAppStub = {
	isHydrating: boolean
	runWithContext: <T>(run: () => T) => T
}

const stateValues = new Map<string, Ref<unknown>>()
const nuxtAppStub: NuxtAppStub = {
	isHydrating: false,
	runWithContext: (run) => run(),
}

export function defineNuxtPlugin<T>(plugin: T): T {
	return plugin
}

export function defineNuxtRouteMiddleware<T>(middleware: T): T {
	return middleware
}

export function tryUseNuxtApp(): NuxtAppStub {
	return nuxtAppStub
}

export function useNuxtApp(): NuxtAppStub {
	return nuxtAppStub
}

export function useState<T>(key: string, init: () => T): Ref<T> {
	let state = stateValues.get(key) as Ref<T> | undefined
	if (state === undefined) {
		state = ref(init()) as Ref<T>
		stateValues.set(key, state)
	}
	return state
}

export function navigateTo(to: string): string {
	return to
}

export function showError(error: Error | string): never {
	throw error instanceof Error ? error : new Error(error)
}

export function useRequestHeaders(): Record<string, string | undefined> {
	return {}
}

export function useRequestURL(): URL {
	return new URL('http://localhost/')
}
