import type { AssistantModelMessage, ModelMessage, ToolResultPart } from 'ai'

import type { AgentRunModelContext } from './types'
import type {
	AgentRunEvent,
	AgentRunModelContent,
	AgentRunModelMessage,
	AgentRunModelMessageOutcome,
	AgentRunToolCallOutcome,
	AgentRunToolOutput,
} from '../../domain/agent-run'

export function buildAgentRunModelContext(events: AgentRunEvent[], contextThroughCursor: string | null): AgentRunModelContext {
	const scoped = eventsForContext(events, contextThroughCursor)
	return { messages: scoped.flatMap((event) => modelVisibleMessages(event, scoped)) }
}

function eventsForContext(events: AgentRunEvent[], contextThroughCursor: string | null): AgentRunEvent[] {
	const bounded = sortEvents(events.filter((event) => contextThroughCursor === null || event.cursor <= contextThroughCursor))
	const compaction = latestCompaction(bounded)
	return compaction === null ? bounded : compactedEventsForContext(bounded, compaction)
}

function compactedEventsForContext(events: AgentRunEvent[], compaction: AgentRunEventWithBody<'context-compacted'>): AgentRunEvent[] {
	const kept = events.filter((event) => event.cursor >= compaction.body.firstKeptCursor)
	const instruction = latestInstructionSnapshot(events)
	return instruction === null || kept.some((event) => event.cursor === instruction.cursor)
		? [compaction, ...kept]
		: [instruction, compaction, ...kept]
}

type AgentRunEventWithBody<TType extends AgentRunEvent['body']['type']> = AgentRunEvent & {
	body: Extract<AgentRunEvent['body'], { type: TType }>
}

function latestCompaction(events: AgentRunEvent[]): AgentRunEventWithBody<'context-compacted'> | null {
	const compactions = events.filter(
		(event): event is AgentRunEventWithBody<'context-compacted'> => event.body.type === 'context-compacted',
	)
	return compactions.at(-1) ?? null
}

function latestInstructionSnapshot(events: AgentRunEvent[]): AgentRunEventWithBody<'instruction-snapshot'> | null {
	const instructions = events.filter(
		(event): event is AgentRunEventWithBody<'instruction-snapshot'> => event.body.type === 'instruction-snapshot',
	)
	return instructions.at(-1) ?? null
}

function sortEvents(events: AgentRunEvent[]): AgentRunEvent[] {
	return [...events].sort((left, right) => left.cursor.localeCompare(right.cursor))
}

function modelVisibleMessages(event: AgentRunEvent, events: AgentRunEvent[]): ModelMessage[] {
	switch (event.body.type) {
		case 'agent-run-model-selected':
		case 'turn-started':
		case 'model-message-started':
		case 'tool-call-started':
		case 'proposed-plan-output':
		case 'proposed-revision-output':
			return []
		case 'instruction-snapshot':
			return [{ role: 'system', content: textContent(event.body.instruction.content) }]
		case 'input-message':
			return [{ role: 'user', content: textContent(event.body.content) }]
		case 'model-message-ended':
			return modelOutcomeMessages(event.body.outcome)
		case 'tool-call-ended':
			return toolOutcomeMessages(event.body.outcome, startedToolCall(event.body.toolCallStartedCursor, events))
		case 'turn-ended':
			return turnEndedMessages(event.body.outcome)
		case 'proposal-accepted':
			return [{ role: 'system', content: `Proposal ${event.body.proposalCursor} accepted.` }]
		case 'proposal-rejected':
			return [
				{
					role: 'system',
					content: `Proposal ${event.body.proposalCursor} rejected.${event.body.reason === null ? '' : ` ${event.body.reason}`}`,
				},
			]
		case 'interrupt-requested':
			return [{ role: 'system', content: `Interrupt requested.${event.body.reason === null ? '' : ` ${event.body.reason}`}` }]
		case 'context-compacted':
			return [{ role: 'system', content: `Compacted context summary:\n${event.body.summary}` }]
		default:
			throw new Error(`Unexpected Agent Run event body: ${String(event.body satisfies never)}`)
	}
}

function modelOutcomeMessages(outcome: AgentRunModelMessageOutcome): ModelMessage[] {
	switch (outcome.type) {
		case 'stop':
		case 'tool-calls':
			return [assistantMessage(outcome.message)]
		case 'length':
			return [
				assistantMessage(outcome.message),
				systemMessage(`Model stopped due to length.${outcome.summary === null ? '' : ` ${outcome.summary}`}`),
			]
		case 'error':
			return [systemMessage(`Model error (${outcome.reason.type}): ${outcome.summary}`)]
		case 'aborted':
			return [systemMessage(`Model aborted (${outcome.reason.type}).${outcome.summary === null ? '' : ` ${outcome.summary}`}`)]
		default:
			throw new Error(`Unexpected Agent Run model message outcome: ${String(outcome satisfies never)}`)
	}
}

function assistantMessage(message: AgentRunModelMessage): AssistantModelMessage {
	return { role: 'assistant', content: assistantContent(message.content) }
}

function assistantContent(content: AgentRunModelContent[]): AssistantModelMessage['content'] {
	const parts = content.map((part) => {
		switch (part.type) {
			case 'text':
				return { type: 'text', text: part.text } as const
			case 'thinking':
				return { type: 'reasoning', text: part.text } as const
			case 'tool-call':
				return { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input } as const
			default:
				throw new Error(`Unexpected Agent Run model content: ${String(part satisfies never)}`)
		}
	})
	return parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts
}

function toolOutcomeMessages(
	outcome: AgentRunToolCallOutcome,
	started: Extract<AgentRunEvent['body'], { type: 'tool-call-started' }> | null,
): ModelMessage[] {
	if (started === null) return [systemMessage(`Tool result could not be projected because its start event is missing.`)]
	return [
		{
			role: 'tool',
			content: [toolResultPart(started, outcome)],
		},
	]
}

function toolResultPart(
	started: Extract<AgentRunEvent['body'], { type: 'tool-call-started' }>,
	outcome: AgentRunToolCallOutcome,
): ToolResultPart {
	return {
		type: 'tool-result',
		toolCallId: started.toolCallId,
		toolName: started.toolName,
		output:
			outcome.type === 'success'
				? { type: 'text', value: toolOutputText(outcome.output) }
				: { type: 'error-text', value: toolOutcomeText(outcome) },
	}
}

function startedToolCall(cursor: string, events: AgentRunEvent[]): Extract<AgentRunEvent['body'], { type: 'tool-call-started' }> | null {
	const event = events.find((candidate) => candidate.cursor === cursor)
	return event?.body.type === 'tool-call-started' ? event.body : null
}

function turnEndedMessages(outcome: Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome']): ModelMessage[] {
	switch (outcome.type) {
		case 'completed':
			return []
		case 'error':
			return [systemMessage(`Turn error (${outcome.reason.type}): ${outcome.summary}`)]
		case 'aborted':
			return [systemMessage(`Turn aborted (${outcome.reason.type}).${outcome.summary === null ? '' : ` ${outcome.summary}`}`)]
		default:
			throw new Error(`Unexpected turn outcome: ${String(outcome satisfies never)}`)
	}
}

function systemMessage(content: string): ModelMessage {
	return { role: 'system', content }
}

function toolOutcomeText(outcome: AgentRunToolCallOutcome): string {
	if (outcome.type === 'success') return toolOutputText(outcome.output)
	if (outcome.type === 'error') return `Tool error (${outcome.reason.type}).\n${toolOutputText(outcome.output)}`
	return `Tool aborted (${outcome.reason.type}).${outcome.output === null ? '' : `\n${toolOutputText(outcome.output)}`}`
}

function toolOutputText(output: AgentRunToolOutput): string {
	return textContent(output.content)
}

function textContent(content: Array<{ text: string }>): string {
	return content.map((part) => part.text).join('\n')
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { localStamp } = await import('../../utils/test-helpers')

	describe('buildAgentRunModelContext', () => {
		it('omits metadata and projects visible input/model/tool events', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, {
						type: 'agent-run-model-selected',
						modelId: 'model-1',
						thinkingLevel: 'none',
						authorized: null,
					}),
					event(2, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						content: [{ type: 'text', text: 'Hello' }],
					}),
					event(3, { type: 'model-message-started', turnStartedCursor: cursor(1), aiSdkCallId: null }),
					event(4, { type: 'model-message-ended', modelMessageStartedCursor: cursor(3), outcome: stopOutcome('Hi') }),
					event(5, {
						type: 'tool-call-started',
						modelMessageCursor: cursor(4),
						toolCallId: 'tool-1',
						toolName: 'tool',
						input: {},
					}),
					event(6, {
						type: 'tool-call-ended',
						toolCallStartedCursor: cursor(5),
						outcome: { type: 'success', output: toolOutput('Done.') },
					}),
				],
				cursor(6),
			)

			expect(context.messages).toEqual([
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
				{
					role: 'tool',
					content: [{ type: 'tool-result', toolCallId: 'tool-1', toolName: 'tool', output: { type: 'text', value: 'Done.' } }],
				},
			])
		})

		it('uses the latest compaction summary as a context boundary', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'old' }] }),
					event(2, {
						type: 'context-compacted',
						source: { type: 'runtime' },
						summary: 'summary',
						firstKeptCursor: cursor(3),
					}),
					event(3, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						content: [{ type: 'text', text: 'new' }],
					}),
				],
				cursor(3),
			)

			expect(context.messages).toEqual([
				{ role: 'system', content: 'Compacted context summary:\nsummary' },
				{ role: 'user', content: 'new' },
			])
		})
	})

	function event(index: number, body: AgentRunEvent['body']): AgentRunEvent {
		return {
			id: `event-${index}`,
			agentRunId: 'agent-run-1',
			cursor: cursor(index),
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body,
		}
	}

	function cursor(index: number): string {
		return `01J000000000000000000${index.toString().padStart(5, '0')}`
	}

	function stopOutcome(text: string): AgentRunModelMessageOutcome {
		return { type: 'stop', message: { content: [{ type: 'text', text }], usage: null, providerResponseRef: null } }
	}

	function toolOutput(text: string): AgentRunToolOutput {
		return { content: [{ type: 'text', text }], truncation: null }
	}
}
