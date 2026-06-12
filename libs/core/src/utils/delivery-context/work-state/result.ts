import type { WorkStateResult } from './types'
import type { InvariantViolationError } from '../../../errors'
import type { Result } from '../../types'

export async function firstState<T>(
	steps: Array<() => WorkStateResult<T | null> | Promise<WorkStateResult<T | null>>>,
): Promise<WorkStateResult<T | null>> {
	for (const step of steps) {
		const result = await step()
		if (!result.ok) return result
		if (result.value !== null) return result
	}

	return ok(null)
}

export function firstSyncState<T>(steps: Array<() => WorkStateResult<T | null>>): WorkStateResult<T | null> {
	for (const step of steps) {
		const result = step()
		if (!result.ok) return result
		if (result.value !== null) return result
	}

	return ok(null)
}

export async function stateOrElse<T>(
	result: WorkStateResult<T | null>,
	fallback: () => WorkStateResult<T> | Promise<WorkStateResult<T>>,
): Promise<WorkStateResult<T>> {
	if (!result.ok) return result

	return result.value === null ? fallback() : ok(result.value)
}

export function stateOrElseSync<T>(result: WorkStateResult<T | null>, fallback: () => WorkStateResult<T>): WorkStateResult<T> {
	if (!result.ok) return result

	return result.value === null ? fallback() : ok(result.value)
}

export function resultValue<T>(result: Result<T, unknown>): T {
	if (!result.ok) throw new Error('Expected a successful result after checking failures.')

	return result.value
}

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}

export function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}
