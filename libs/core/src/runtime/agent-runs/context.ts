import type { AgentRunModelContext, AgentRunProviderMessage } from './types'
import type { AgentRunEvent, AgentRunModelMessageOutcome, AgentRunToolCallOutcome, AgentRunToolOutput } from '../../domain/agent-run'

export function buildAgentRunModelContext(events: AgentRunEvent[], contextThroughSequence: number): AgentRunModelContext {
	const scoped = eventsForContext(events, contextThroughSequence)
	return { messages: scoped.flatMap(modelVisibleMessages) }
}

function eventsForContext(events: AgentRunEvent[], contextThroughSequence: number): AgentRunEvent[] {
	const bounded = sortEvents(events.filter((event) => event.sequence <= contextThroughSequence))
	const compaction = latestCompaction(bounded)
	return compaction === null ? bounded : compactedEventsForContext(bounded, compaction)
}

function compactedEventsForContext(events: AgentRunEvent[], compaction: AgentRunEventWithBody<'context-compacted'>): AgentRunEvent[] {
	const kept = events.filter((event) => event.sequence >= compaction.body.firstKeptSequence)
	const instruction = latestInstructionSnapshot(events)
	return instruction === null || kept.some((event) => event.id === instruction.id)
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
	return [...events].sort((left, right) => left.sequence - right.sequence)
}

function modelVisibleMessages(event: AgentRunEvent): AgentRunProviderMessage[] {
	switch (event.body.type) {
		case 'agent-run-model-selected':
		case 'turn-started':
		case 'turn-ended':
		case 'model-message-started':
		case 'tool-call-started':
			return []
		case 'instruction-snapshot':
			return [{ role: 'system', content: textContent(event.body.instruction.content) }]
		case 'input-message':
			return [{ role: event.body.source.type === 'operator' ? 'user' : 'system', content: textContent(event.body.content) }]
		case 'model-message-ended':
			return [{ role: 'assistant', content: modelOutcomeText(event.body.outcome) }]
		case 'tool-call-scheduled':
			return event.body.scheduling.type === 'refused'
				? [{ role: 'tool', content: `Tool ${event.body.toolName} refused.\n${toolOutputText(event.body.scheduling.output)}` }]
				: []
		case 'tool-call-ended':
			return [{ role: 'tool', content: toolOutcomeText(event.body.outcome) }]
		case 'proposed-plan-output':
			return [{ role: 'assistant', content: `Proposed Plan Output: ${JSON.stringify(event.body.output)}` }]
		case 'proposed-revision-output':
			return [{ role: 'assistant', content: `Proposed Revision Output: ${JSON.stringify(event.body.output)}` }]
		case 'proposal-accepted':
			return [{ role: 'user', content: `Proposal ${event.body.proposalEventId} accepted.` }]
		case 'proposal-rejected':
			return [
				{
					role: 'user',
					content: `Proposal ${event.body.proposalEventId} rejected.${event.body.reason === null ? '' : ` ${event.body.reason}`}`,
				},
			]
		case 'interrupt-requested':
			return [{ role: 'user', content: `Interrupt requested.${event.body.reason === null ? '' : ` ${event.body.reason}`}` }]
		case 'context-compacted':
			return [{ role: 'system', content: `Compacted context summary:\n${event.body.summary}` }]
		default:
			throw new Error(`Unexpected Agent Run event body: ${String(event.body satisfies never)}`)
	}
}

function modelOutcomeText(outcome: AgentRunModelMessageOutcome): string {
	switch (outcome.type) {
		case 'stop':
		case 'tool-use':
			return modelMessageText(outcome.message)
		case 'length':
			return `${modelMessageText(outcome.message)}\n[Model stopped due to length.${outcome.summary === null ? '' : ` ${outcome.summary}`}]`
		case 'error':
			return `Model error: ${outcome.summary}`
		case 'aborted':
			return `Model aborted: ${outcome.summary ?? outcome.reason.type}`
		default:
			throw new Error(`Unexpected Agent Run model message outcome: ${String(outcome satisfies never)}`)
	}
}

function toolOutcomeText(outcome: AgentRunToolCallOutcome): string {
	if (outcome.type === 'success') return toolOutputText(outcome.output)
	if (outcome.type === 'error') return `Tool error (${outcome.reason.type}).\n${toolOutputText(outcome.output)}`
	return `Tool aborted (${outcome.reason.type}).${outcome.output === null ? '' : `\n${toolOutputText(outcome.output)}`}`
}

function modelMessageText(
	message: AgentRunModelMessageOutcome extends { message: infer TMessage } ? NonNullable<TMessage> : never,
): string {
	return message.content
		.map((content) => {
			if (content.type === 'tool-call')
				return `[Tool call ${content.toolName} ${content.toolCallId}: ${JSON.stringify(content.input)}]`
			return content.text
		})
		.join('\n')
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
		it('omits metadata and serializes visible input/model/tool/proposal events', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, {
						type: 'agent-run-model-selected',
						modelId: 'model-1',
						thinkingLevel: 'off',
						authorized: null,
					}),
					event(2, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						content: [{ type: 'text', text: 'Hello' }],
					}),
					event(3, { type: 'model-message-started', turnStartedEventId: 'turn-1' }),
					event(4, { type: 'model-message-ended', modelMessageStartedEventId: 'model-started', outcome: stopOutcome('Hi') }),
					event(5, {
						type: 'tool-call-scheduled',
						modelMessageEventId: 'model-ended',
						toolCallId: 'tool-1',
						toolName: 'bad-tool',
						input: {},
						scheduling: { type: 'refused', reason: { type: 'unknown-tool' }, output: toolOutput('No tool.') },
					}),
				],
				5,
			)

			expect(context.messages).toEqual([
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
				{ role: 'tool', content: 'Tool bad-tool refused.\nNo tool.' },
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
						firstKeptEventId: 'event-3',
						firstKeptSequence: 3,
					}),
					event(3, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						content: [{ type: 'text', text: 'new' }],
					}),
				],
				3,
			)

			expect(context.messages).toEqual([
				{ role: 'system', content: 'Compacted context summary:\nsummary' },
				{ role: 'user', content: 'new' },
			])
		})

		it('renders instruction snapshots as system messages and preserves the latest one through compaction', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, instructionSnapshot('Use old instructions.')),
					event(2, instructionSnapshot('Use current instructions.')),
					event(3, { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'old' }] }),
					event(4, {
						type: 'context-compacted',
						source: { type: 'runtime' },
						summary: 'summary',
						firstKeptEventId: 'event-5',
						firstKeptSequence: 5,
					}),
					event(5, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						content: [{ type: 'text', text: 'new' }],
					}),
				],
				5,
			)

			expect(context.messages).toEqual([
				{ role: 'system', content: 'Use current instructions.' },
				{ role: 'system', content: 'Compacted context summary:\nsummary' },
				{ role: 'user', content: 'new' },
			])
		})

		it('serializes aborted model and tool outcomes with explicit markers', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, {
						type: 'model-message-ended',
						modelMessageStartedEventId: 'model-started',
						outcome: { type: 'aborted', reason: { type: 'timeout' }, message: null, summary: 'Timed out.' },
					}),
					event(2, {
						type: 'tool-call-ended',
						toolCallScheduledEventId: 'scheduled',
						toolCallId: 'tool-1',
						outcome: { type: 'aborted', reason: { type: 'timeout' }, output: toolOutput('partial') },
					}),
				],
				2,
			)

			expect(context.messages).toEqual([
				{ role: 'assistant', content: 'Model aborted: Timed out.' },
				{ role: 'tool', content: 'Tool aborted (timeout).\npartial' },
			])
		})
	})

	function event(sequence: number, body: AgentRunEvent['body']): AgentRunEvent {
		return { id: `event-${sequence}`, agentRunId: 'agent-run-1', sequence, occurred: { at: '2026-06-10T12:00:00.000Z' }, body }
	}

	function instructionSnapshot(text: string): AgentRunEvent['body'] {
		return {
			type: 'instruction-snapshot',
			instruction: { type: 'source-control-planning', version: 1, content: [{ type: 'text', text }] },
		}
	}

	function stopOutcome(text: string): AgentRunModelMessageOutcome {
		return { type: 'stop', message: { content: [{ type: 'text', text }], usage: null, providerResponseRef: null } }
	}

	function toolOutput(text: string): AgentRunToolOutput {
		return { content: [{ type: 'text', text }], truncation: null }
	}
}
