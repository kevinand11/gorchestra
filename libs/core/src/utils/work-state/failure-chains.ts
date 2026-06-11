import { compareActions, latestAction } from './actions'
import type { Action, ActionResult } from '../../domain/action'
import type { FailureChain } from '../../domain/slice'

export function latestFailureChainBefore(action: Action, sliceActions: Action[]): FailureChain {
	const failedAction = latestAction(sliceActions.filter((candidate) => isFailureChainRootCandidate(candidate, action)))

	return failedAction === null ? { rootActionId: action.id, correctionRetries: 0 } : failureChainFromRoot(failedAction, sliceActions)
}

function isFailureChainRootCandidate(candidate: Action, before: Action): boolean {
	return compareActions(candidate, before) < 0 && isFailureChainRoot(candidate)
}

function isFailureChainRoot(action: Action): boolean {
	return action.result.type === 'record-slice-external-operation-failure' || isFailedSliceValidation(action.result)
}

function isFailedSliceValidation(result: ActionResult): boolean {
	return isSliceValidationResult(result) && !result.evidence.passed
}

function isSliceValidationResult(
	result: ActionResult,
): result is Extract<ActionResult, { type: 'validate-slice-artifact' | 'validate-slice-delivery-artifact' }> {
	return result.type === 'validate-slice-artifact' || result.type === 'validate-slice-delivery-artifact'
}

function failureChainFromRoot(root: Action, sliceActions: Action[]): FailureChain {
	return {
		rootActionId: root.id,
		correctionRetries: sliceActions.filter(
			(action) =>
				action.result.type === 'start-slice-execution' && action.result.mode === 'correction' && compareActions(action, root) > 0,
		).length,
	}
}
