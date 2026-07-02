import type { AgentRunModelContext, AgentRunProviderMessage } from './types'
import type { AgentRunEvent, AgentRunModelMessageOutcome, AgentRunToolCallOutcome, AgentRunToolOutput } from '../../domain/agent-run'

export function buildAgentRunModelContext(events: AgentRunEvent[], contextThroughSequence: number): AgentRunModelContext {
	const scoped = eventsForContext(events, contextThroughSequence)
	return { messages: scoped.flatMap(modelVisibleMessages) }
}

function eventsForContext(events: AgentRunEvent[], contextThroughSequence: number): AgentRunEvent[] {
	const bounded = sortEvents(events.filter((event) => event.sequence <= contextThroughSequence))
	const compaction = latestCompaction(bounded)
	return compaction === null ? bounded : [compaction, ...bounded.filter((event) => event.sequence >= compaction.body.firstKeptSequence)]
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

function sortEvents(events: AgentRunEvent[]): AgentRunEvent[] {
	return [...events].sort((left, right) => left.sequence - right.sequence)
}

function modelVisibleMessages(event: AgentRunEvent): AgentRunProviderMessage[] {
	const serializers = modelVisibleSerializers[event.body.type]
	return serializers === undefined ? [] : serializers(event as never)
}

const modelVisibleSerializers: Partial<{
	[TBody in AgentRunEvent['body'] as TBody['type']]: (event: AgentRunEvent & { body: TBody }) => AgentRunProviderMessage[]
}> = {
	'input-message': (event) => [
		{ role: event.body.source.type === 'operator' ? 'user' : 'system', content: textContent(event.body.content) },
	],
	'model-message-ended': (event) => [{ role: 'assistant', content: modelOutcomeText(event.body.outcome) }],
	'tool-call-scheduled': (event) =>
		event.body.scheduling.type === 'refused'
			? [{ role: 'tool', content: `Tool ${event.body.toolName} refused.\n${toolOutputText(event.body.scheduling.output)}` }]
			: [],
	'tool-call-ended': (event) => [{ role: 'tool', content: toolOutcomeText(event.body.outcome) }],
	'proposed-plan-output': (event) => [{ role: 'assistant', content: `Proposed Plan Output: ${JSON.stringify(event.body.output)}` }],
	'proposed-revision-output': (event) => [
		{ role: 'assistant', content: `Proposed Revision Output: ${JSON.stringify(event.body.output)}` },
	],
	'proposal-accepted': (event) => [{ role: 'user', content: `Proposal ${event.body.proposalEventId} accepted.` }],
	'proposal-rejected': (event) => [
		{
			role: 'user',
			content: `Proposal ${event.body.proposalEventId} rejected.${event.body.reason === null ? '' : ` ${event.body.reason}`}`,
		},
	],
	'interrupt-requested': (event) => [
		{ role: 'user', content: `Interrupt requested.${event.body.reason === null ? '' : ` ${event.body.reason}`}` },
	],
	'context-compacted': (event) => [{ role: 'system', content: `Compacted context summary:\n${event.body.summary}` }],
}

function modelOutcomeText(outcome: AgentRunModelMessageOutcome): string {
	return modelOutcomeTextSerializers[outcome.type](outcome as never)
}

const modelOutcomeTextSerializers = {
	stop: (outcome: Extract<AgentRunModelMessageOutcome, { type: 'stop' }>) => modelMessageText(outcome.message),
	'tool-use': (outcome: Extract<AgentRunModelMessageOutcome, { type: 'tool-use' }>) => modelMessageText(outcome.message),
	length: (outcome: Extract<AgentRunModelMessageOutcome, { type: 'length' }>) =>
		`${modelMessageText(outcome.message)}\n[Model stopped due to length.${outcome.summary === null ? '' : ` ${outcome.summary}`}]`,
	error: (outcome: Extract<AgentRunModelMessageOutcome, { type: 'error' }>) => `Model error: ${outcome.summary}`,
	aborted: (outcome: Extract<AgentRunModelMessageOutcome, { type: 'aborted' }>) =>
		`Model aborted: ${outcome.summary ?? outcome.reason.type}`,
} satisfies Record<AgentRunModelMessageOutcome['type'], (outcome: never) => string>

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

	function stopOutcome(text: string): AgentRunModelMessageOutcome {
		return { type: 'stop', message: { content: [{ type: 'text', text }], usage: null, providerResponseRef: null } }
	}

	function toolOutput(text: string): AgentRunToolOutput {
		return { content: [{ type: 'text', text }], truncation: null }
	}
}
