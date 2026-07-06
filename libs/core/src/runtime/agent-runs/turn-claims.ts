import type { AgentRunEvent } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'

export interface TurnReasonClaim {
	reason: Extract<AgentRunEvent['body'], { type: 'turn-started' }>['reason']
	contextThroughEventId: Id
}

export function nextTurnClaim(events: AgentRunEvent[]): TurnReasonClaim | null {
	const reason = nextInputTurnReason(events)
	const contextThroughEventId = events.at(-1)?.id
	return reason === null || contextThroughEventId === undefined ? null : { reason, contextThroughEventId }
}

function nextInputTurnReason(events: AgentRunEvent[]): TurnReasonClaim['reason'] | null {
	if (hasBlockingOperatorInterrupt(events)) return null

	const inputEventIds = unprocessedInputEventIds(events)
	return inputEventIds.length === 0 ? null : { type: 'input', inputEventIds }
}

function hasBlockingOperatorInterrupt(events: AgentRunEvent[]): boolean {
	const latestInput = latestEventId(events, (event) => event.body.type === 'input-message')
	const latestOperatorInterrupt = latestEventId(
		events,
		(event) => event.body.type === 'interrupt-requested' && event.body.source.type === 'operator',
	)
	return latestInput === null
		? latestOperatorInterrupt !== null
		: latestOperatorInterrupt !== null && latestOperatorInterrupt > latestInput
}

function unprocessedInputEventIds(events: AgentRunEvent[]): Id[] {
	const latestTurnStarted = latestEventId(events, (event) => event.body.type === 'turn-started')
	return events
		.filter((event) => (latestTurnStarted === null || event.id > latestTurnStarted) && event.body.type === 'input-message')
		.map((event) => event.id)
}

function latestEventId(events: AgentRunEvent[], predicate: (event: AgentRunEvent) => boolean): Id | null {
	return events.filter(predicate).at(-1)?.id ?? null
}
