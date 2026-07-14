import { maxDispatchAttemptHistory, type DispatchAttemptHistory } from '../domain/dispatch-request'

export function appendBoundedDispatchAttemptHistory(
	history: readonly DispatchAttemptHistory[],
	entry: DispatchAttemptHistory,
): DispatchAttemptHistory[] {
	return [...history, entry].slice(-maxDispatchAttemptHistory)
}
