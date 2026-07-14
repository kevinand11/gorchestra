import { AsyncLocalStorage } from 'node:async_hooks'

import type { DispatchAttemptController } from './fence'
import type { CoreTransaction } from '../utils/transactions'
import type { Result } from '../utils/types'

interface DispatchAttemptContext {
	attempt: DispatchAttemptController
	insideFencedWrite: boolean
}

const dispatchAttemptContext = new AsyncLocalStorage<DispatchAttemptContext>()
const terminalFinalizers = new WeakMap<DispatchAttemptController, Array<(tx: CoreTransaction) => Promise<Result<void, unknown>>>>()

export function runWithDispatchAttempt<T>(attempt: DispatchAttemptController, operation: () => Promise<T>): Promise<T> {
	return dispatchAttemptContext.run({ attempt, insideFencedWrite: false }, operation)
}

export function runInsideDispatchFencedWrite<T>(operation: () => Promise<T>): Promise<T> {
	const current = dispatchAttemptContext.getStore()
	return current === undefined
		? operation()
		: dispatchAttemptContext.run({ attempt: current.attempt, insideFencedWrite: true }, operation)
}

export function registerDispatchTerminalFinalizer(finalizer: (tx: CoreTransaction) => Promise<Result<void, unknown>>): boolean {
	const current = dispatchAttemptContext.getStore()
	if (current === undefined) return false
	const registered = terminalFinalizers.get(current.attempt) ?? []
	registered.push(finalizer)
	terminalFinalizers.set(current.attempt, registered)
	return true
}

export async function runDispatchTerminalFinalizers(
	attempt: DispatchAttemptController,
	tx: CoreTransaction,
): Promise<Result<void, unknown>> {
	for (const finalizer of terminalFinalizers.get(attempt) ?? []) {
		const result = await finalizer(tx)
		if (!result.ok) return result
	}
	terminalFinalizers.delete(attempt)
	return { ok: true, value: undefined }
}

export function currentDispatchAttemptForWrite(): DispatchAttemptController | null {
	const current = dispatchAttemptContext.getStore()
	return current === undefined || current.insideFencedWrite ? null : current.attempt
}
