import { invariant, ok } from './result'
import type { SliceDeliveryValidationAction, WorkStateResult } from './types'
import type { Action, ActionResult } from '../../../domain/action'
import type { AgentRun } from '../../../domain/agent-run'
import type { Id } from '../../../domain/commons'
import type { DeliveryWorkOperation } from '../../../domain/delivery-work-operation'
import type { DispatchRequest } from '../../../domain/dispatch-request'

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

	return ok(maxAction(known))
}

export function getKnownAgentRun(agentRunId: Id, agentRuns: AgentRun[]): WorkStateResult<AgentRun> {
	const agentRun = agentRuns.find((run) => run.id === agentRunId)
	return agentRun === undefined ? invariant(`Agent Run ${agentRunId} is missing.`) : ok(agentRun)
}

export function latestAction<TAction extends Action>(actions: TAction[]): TAction | null {
	return actions.at(-1) ?? null
}

function maxAction<TAction extends Action>(actions: TAction[]): TAction | null {
	return actions.reduce<TAction | null>(
		(latest, action) => (latest === null || compareActions(action, latest) > 0 ? action : latest),
		null,
	)
}

export function compareActions(left: Action, right: Action): number {
	const byTime = left.performed.at.localeCompare(right.performed.at)
	if (byTime !== 0) return byTime

	return left.id.localeCompare(right.id)
}

type DeliveryOperationRequest = DispatchRequest & {
	payload: Extract<DispatchRequest['payload'], { type: 'delivery-work-operation' }>
}

export function latestInTransitDispatchForOperation(
	requests: DispatchRequest[],
	predicate: (operation: DeliveryWorkOperation) => boolean,
	excludeRequestId?: Id,
): { type: 'running'; request: DeliveryOperationRequest } | { type: 'queued'; request: DeliveryOperationRequest } | null {
	const matching = requests
		.filter(
			(request): request is DeliveryOperationRequest =>
				request.id !== excludeRequestId &&
				request.payload.type === 'delivery-work-operation' &&
				predicate(request.payload.operation) &&
				(request.lifecycle.type === 'pending' || request.lifecycle.type === 'leased'),
		)
		.sort((left, right) => left.accepted.at.localeCompare(right.accepted.at) || left.id.localeCompare(right.id))
	const request = matching.at(-1)
	if (request === undefined) return null
	return request.lifecycle.type === 'leased' ? { type: 'running', request } : { type: 'queued', request }
}

function isSliceDeliveryValidationAction(action: Action): action is SliceDeliveryValidationAction {
	return action.result.type === 'validate-slice-delivery-artifact'
}

function actionResultSliceId(result: ActionResult): Id | null {
	return 'sliceId' in result ? result.sliceId : null
}
