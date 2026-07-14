import type { AgentRunEvent } from '../../../domain/agent-run-event'
import type { Id } from '../../../domain/commons'

type TurnStartedEvent = AgentRunEvent & { body: Extract<AgentRunEvent['body'], { type: 'turn-started' }> }

export interface TurnReasonClaim {
	reason: Extract<AgentRunEvent['body'], { type: 'turn-started' }>['reason']
	contextThroughEventId: Id
	turnStartedEvent: TurnStartedEvent | null
}

export function nextTurnClaim(events: AgentRunEvent[]): TurnReasonClaim | null {
	const contextThroughEventId = events.at(-1)?.id
	if (contextThroughEventId === undefined) return null
	const openTurn = [...events]
		.reverse()
		.find(
			(event): event is TurnStartedEvent =>
				event.body.type === 'turn-started' &&
				!events.some((candidate) => candidate.body.type === 'turn-ended' && candidate.body.turnStartedEventId === event.id),
		)
	if (openTurn !== undefined) {
		return { reason: openTurn.body.reason, contextThroughEventId, turnStartedEvent: openTurn }
	}

	const reason = nextInputTurnReason(events)
	return reason === null ? null : { reason, contextThroughEventId, turnStartedEvent: null }
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
