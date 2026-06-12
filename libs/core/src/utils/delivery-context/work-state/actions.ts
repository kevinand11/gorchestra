import { invariant, ok } from './result'
import type { SliceDeliveryValidationAction, WorkStateResult } from './types'
import type { Action, ActionResult } from '../../../domain/action'
import type { AgentRun } from '../../../domain/agent-run'
import type { Id } from '../../../domain/commons'

export function latestPassedSlicePromotion(sliceId: Id, sliceActions: Action[]): Action | null {
	return latestAction(
		sliceActions.filter(
			(action) =>
				action.result.type === 'promote-slice-artifact' && action.result.sliceId === sliceId && action.result.evidence.passed,
		),
	)
}

export function latestSliceDeliveryValidationAfter(
	sliceId: Id,
	sliceActions: Action[],
	promotion: Action,
): SliceDeliveryValidationAction | null {
	return latestAction(
		sliceActions
			.filter(isSliceDeliveryValidationAction)
			.filter((action) => action.result.sliceId === sliceId && compareActions(action, promotion) > 0),
	)
}

export function actionAffectsSlice(action: Action, sliceId: Id): boolean {
	return actionResultSliceId(action.result) === sliceId
}

export function latestKnownAction(actionIds: Id[], actions: Action[]): WorkStateResult<Action | null> {
	const byId = new Map(actions.map((action) => [action.id, action]))
	const known: Action[] = []
	for (const actionId of actionIds) {
		const action = byId.get(actionId)
		if (action === undefined) return invariant(`Action ${actionId} is missing.`)
		known.push(action)
	}

	return ok(latestAction(known))
}

export function getKnownAgentRun(agentRunId: Id, agentRuns: AgentRun[]): WorkStateResult<AgentRun> {
	const agentRun = agentRuns.find((run) => run.id === agentRunId)
	return agentRun === undefined ? invariant(`Agent Run ${agentRunId} is missing.`) : ok(agentRun)
}

export function sortedActions<TAction extends Action>(actions: TAction[]): TAction[] {
	return [...actions].sort(compareActions)
}

export function latestAction<TAction extends Action>(actions: TAction[]): TAction | null {
	return sortedActions(actions).at(-1) ?? null
}

export function compareActions(left: Action, right: Action): number {
	const byTime = left.performed.at.localeCompare(right.performed.at)
	if (byTime !== 0) return byTime

	return left.id.localeCompare(right.id)
}

function isSliceDeliveryValidationAction(action: Action): action is SliceDeliveryValidationAction {
	return action.result.type === 'validate-slice-delivery-artifact'
}

function actionResultSliceId(result: ActionResult): Id | null {
	return 'sliceId' in result ? result.sliceId : null
}
