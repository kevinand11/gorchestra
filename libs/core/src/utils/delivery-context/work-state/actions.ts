import { invariant, ok } from './result'
import type { SliceDeliveryValidationAction, WorkStateResult } from './types'
import type { Action, ActionResult, DeliveryWorkOperation } from '../../../domain/action'
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

type QueuedDeliveryWorkDispatchAction = Action & { result: Extract<ActionResult, { type: 'queue-delivery-work-operation' }> }
type StartedDeliveryWorkDispatchAction = Action & { result: Extract<ActionResult, { type: 'start-delivery-work-operation' }> }
type FinishedDeliveryWorkDispatchAction = Action & { result: Extract<ActionResult, { type: 'finish-delivery-work-operation' }> }

export function queuedDispatchActions(actions: Action[]): QueuedDeliveryWorkDispatchAction[] {
	return actions.filter((action): action is QueuedDeliveryWorkDispatchAction => action.result.type === 'queue-delivery-work-operation')
}

export function startedDispatchActions(actions: Action[]): StartedDeliveryWorkDispatchAction[] {
	return actions.filter((action): action is StartedDeliveryWorkDispatchAction => action.result.type === 'start-delivery-work-operation')
}

export function finishedDispatchActions(actions: Action[]): FinishedDeliveryWorkDispatchAction[] {
	return actions.filter((action): action is FinishedDeliveryWorkDispatchAction => action.result.type === 'finish-delivery-work-operation')
}

export function latestInTransitDispatchForOperation(
	actions: Action[],
	predicate: (operation: DeliveryWorkOperation) => boolean,
): { type: 'running'; action: StartedDeliveryWorkDispatchAction } | { type: 'queued'; action: QueuedDeliveryWorkDispatchAction } | null {
	const queued = queuedDispatchActions(actions)
		.filter((action) => predicate(action.result.operation))
		.sort(compareActions)
	const started = startedDispatchActions(actions).sort(compareActions)
	const finished = finishedDispatchActions(actions).sort(compareActions)

	for (const queuedAction of [...queued].reverse()) {
		const startedAction = [...started].reverse().find((candidate) => candidate.result.queuedActionId === queuedAction.id)
		if (startedAction !== undefined) {
			const finishedAction = finished.find((candidate) => candidate.result.startedActionId === startedAction.id)
			if (finishedAction === undefined) return { type: 'running', action: startedAction }
			continue
		}

		return { type: 'queued', action: queuedAction }
	}

	return null
}

function isSliceDeliveryValidationAction(action: Action): action is SliceDeliveryValidationAction {
	return action.result.type === 'validate-slice-delivery-artifact'
}

function actionResultSliceId(result: ActionResult): Id | null {
	return 'sliceId' in result ? result.sliceId : null
}
