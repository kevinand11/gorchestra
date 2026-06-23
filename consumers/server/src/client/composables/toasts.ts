import { useState } from 'nuxt/app'

export type ToastKind = 'success' | 'error' | 'info'

export type ToastMessage = {
	id: string
	kind: ToastKind
	title: string
	body?: string
}

type ToastInput = {
	title: string
	body?: string
	durationMs?: number
}

const dismissTimers = new Map<string, number>()

export function useToasts() {
	const toasts = useState<ToastMessage[]>('gorchestra.toasts', () => [])
	const nextToastId = useState<number>('gorchestra.toasts.next-id', () => 0)

	function success(input: ToastInput): ToastMessage {
		return add('success', input)
	}

	function error(input: ToastInput): ToastMessage {
		return add('error', input)
	}

	function info(input: ToastInput): ToastMessage {
		return add('info', input)
	}

	function dismiss(id: string): void {
		clearDismissTimer(id)
		toasts.value = toasts.value.filter((toast) => toast.id !== id)
	}

	function clear(): void {
		for (const id of dismissTimers.keys()) clearDismissTimer(id)
		toasts.value = []
	}

	function add(kind: ToastKind, input: ToastInput): ToastMessage {
		nextToastId.value += 1
		const toast: ToastMessage = {
			id: `toast-${nextToastId.value}`,
			kind,
			title: input.title,
			...(input.body === undefined ? {} : { body: input.body }),
		}
		toasts.value = [...toasts.value, toast]
		scheduleDismiss(toast.id, input.durationMs ?? 4000)
		return toast
	}

	function scheduleDismiss(id: string, durationMs: number): void {
		if (typeof window === 'undefined') return
		const timer = window.setTimeout(() => dismiss(id), durationMs)
		dismissTimers.set(id, timer)
	}

	return { toasts, success, error, info, dismiss, clear }
}

function clearDismissTimer(id: string): void {
	const timer = dismissTimers.get(id)
	if (timer === undefined) return
	window.clearTimeout(timer)
	dismissTimers.delete(id)
}
