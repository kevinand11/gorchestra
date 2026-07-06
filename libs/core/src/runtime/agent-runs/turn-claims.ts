import type { AgentRunEvent, AgentRunEventCursor } from '../../domain/agent-run'

export interface TurnReasonClaim {
	reason: Extract<AgentRunEvent['body'], { type: 'turn-started' }>['reason']
	contextThroughCursor: AgentRunEventCursor
}

export function nextTurnClaim(events: AgentRunEvent[]): TurnReasonClaim | null {
	const reason = nextInputTurnReason(events)
	const contextThroughCursor = events.at(-1)?.cursor
	return reason === null || contextThroughCursor === undefined ? null : { reason, contextThroughCursor }
}

function nextInputTurnReason(events: AgentRunEvent[]): TurnReasonClaim['reason'] | null {
	if (hasBlockingOperatorInterrupt(events)) return null

	const inputEventCursors = unprocessedInputEventCursors(events)
	return inputEventCursors.length === 0 ? null : { type: 'input', inputEventCursors }
}

function hasBlockingOperatorInterrupt(events: AgentRunEvent[]): boolean {
	const latestInput = latestCursor(events, (event) => event.body.type === 'input-message')
	const latestOperatorInterrupt = latestCursor(
		events,
		(event) => event.body.type === 'interrupt-requested' && event.body.source.type === 'operator',
	)
	return latestInput === null
		? latestOperatorInterrupt !== null
		: latestOperatorInterrupt !== null && latestOperatorInterrupt > latestInput
}

function unprocessedInputEventCursors(events: AgentRunEvent[]): AgentRunEventCursor[] {
	const latestTurnStarted = latestCursor(events, (event) => event.body.type === 'turn-started')
	return events
		.filter((event) => (latestTurnStarted === null || event.cursor > latestTurnStarted) && event.body.type === 'input-message')
		.map((event) => event.cursor)
}

function latestCursor(events: AgentRunEvent[], predicate: (event: AgentRunEvent) => boolean): AgentRunEventCursor | null {
	return events.filter(predicate).at(-1)?.cursor ?? null
}
