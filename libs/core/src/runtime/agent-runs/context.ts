import type { ModelMessage } from 'ai'

import type { AgentRunModelContext } from './types'
import type {
	AgentRunAssistantTranscriptPart,
	AgentRunEvent,
	AgentRunInputTranscriptPart,
	AgentRunSystemTranscriptPart,
	AgentRunToolResultOutput,
	AgentRunToolTruncation,
} from '../../domain/agent-run'
import type { JsonObject } from '../../domain/commons'

export function buildAgentRunModelContext(events: AgentRunEvent[], contextThroughEventId: string | null): AgentRunModelContext {
	const scoped = eventsForContext(events, contextThroughEventId)
	return { messages: scoped.flatMap((event) => modelVisibleMessages(event)) }
}

function eventsForContext(events: AgentRunEvent[], contextThroughEventId: string | null): AgentRunEvent[] {
	const bounded = sortEvents(events.filter((event) => contextThroughEventId === null || event.id <= contextThroughEventId))
	const compaction = latestCompaction(bounded)
	return compaction === null ? bounded : compactedEventsForContext(bounded, compaction)
}

function compactedEventsForContext(events: AgentRunEvent[], compaction: AgentRunEventWithBody<'context-compacted'>): AgentRunEvent[] {
	const kept = events.filter((event) => event.id > compaction.body.compactedThroughEventId && event.id !== compaction.id)
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
	return [...events].sort((left, right) => left.id.localeCompare(right.id))
}

function modelVisibleMessages(event: AgentRunEvent): ModelMessage[] {
	switch (event.body.type) {
		case 'agent-run-model-use-override-changed':
		case 'agent-run-runtime-requirement-override-added':
		case 'agent-run-sandbox-created':
		case 'agent-run-sandbox-preparation-started':
		case 'agent-run-sandbox-preparation-completed':
		case 'agent-run-sandbox-preparation-failed':
		case 'agent-run-sandbox-release-completed':
		case 'agent-run-sandbox-release-failed':
		case 'turn-started':
		case 'turn-ended':
		case 'interrupt-requested':
		case 'proposed-plan-output':
		case 'proposed-revision-output':
			return []
		case 'instruction-snapshot':
			return [systemMessage(projectSystemParts(event.body.parts))]
		case 'input-message':
			return [{ role: 'user', content: projectInputParts(event.body.parts) }]
		case 'assistant-message':
			return [projectAssistantMessage(event.body)]
		case 'tool-message':
			return [projectToolMessage(event.body)]
		case 'context-compacted':
			return [systemMessage(projectSystemParts(event.body.replacementParts))]
		case 'proposal-accepted':
		case 'proposal-rejected':
			return [systemMessage(projectSystemParts(event.body.projectedParts))]
		default:
			throw new Error(`Unexpected Agent Run event body: ${String(event.body satisfies never)}`)
	}
}

function systemMessage(content: string): ModelMessage {
	return { role: 'system', content }
}

function projectSystemParts(parts: AgentRunSystemTranscriptPart[]): string {
	return parts.map((part) => part.text).join('\n')
}

function projectInputParts(parts: AgentRunInputTranscriptPart[]): string {
	return parts.map((part) => part.text).join('\n')
}

type ProviderOptions = Record<string, Record<string, unknown>>

function withProviderOptions<TPart extends object>(
	part: TPart,
	metadata: JsonObject | null,
): TPart & { providerOptions?: ProviderOptions } {
	return metadata === null ? part : { ...part, providerOptions: metadata as ProviderOptions }
}

function projectAssistantMessage(body: Extract<AgentRunEvent['body'], { type: 'assistant-message' }>): ModelMessage {
	const content = body.parts.flatMap(projectAssistantPart)
	return { role: 'assistant', content } as ModelMessage
}

function projectAssistantPart(part: AgentRunAssistantTranscriptPart): object[] {
	switch (part.type) {
		case 'text':
			return [withProviderOptions({ type: 'text' as const, text: part.text }, part.metadata)]
		case 'tool-call':
			return [
				withProviderOptions(
					{
						type: 'tool-call' as const,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						input: part.input,
						providerExecuted: part.providerExecuted,
					},
					part.metadata,
				),
			]
		case 'tool-result':
			return [
				withProviderOptions(
					{ type: 'tool-result' as const, toolCallId: part.toolCallId, toolName: part.toolName, output: part.output },
					part.metadata,
				),
			]
		case 'tool-error':
			return [
				withProviderOptions(
					{
						type: 'tool-result' as const,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: { type: 'error-text' as const, value: String(part.error) },
					},
					part.metadata,
				),
			]
		case 'tool-approval-request':
			return [{ type: 'tool-approval-request' as const, approvalId: part.approvalId, toolCallId: part.toolCallId }]
		case 'reasoning':
		case 'reasoning-file':
		case 'source':
		case 'file':
		case 'custom':
			return []
		default:
			throw new Error(`Unexpected assistant part: ${String(part satisfies never)}`)
	}
}

function projectToolMessage(body: Extract<AgentRunEvent['body'], { type: 'tool-message' }>): ModelMessage {
	return {
		role: 'tool',
		content: body.parts.map((part) => {
			switch (part.type) {
				case 'tool-result':
					return withProviderOptions(
						{
							type: 'tool-result' as const,
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							output: withTruncationNotice(part.output, part.truncation),
						},
						part.metadata,
					)
				case 'tool-error':
					return withProviderOptions(
						{
							type: 'tool-result' as const,
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							output: withTruncationNotice(part.error, part.truncation),
						},
						part.metadata,
					)
				case 'tool-approval-response':
					return {
						type: 'tool-approval-response' as const,
						approvalId: part.approvalId,
						approved: part.approved,
						...(part.reason === null ? {} : { reason: part.reason }),
					}
				default:
					throw new Error(`Unexpected tool part: ${String(part satisfies never)}`)
			}
		}),
	} as ModelMessage
}

function withTruncationNotice(output: AgentRunToolResultOutput, truncation: AgentRunToolTruncation | null): AgentRunToolResultOutput {
	if (truncation === null || !truncation.truncated) return output
	const notice = truncationNotice(truncation)
	if (output.type === 'text' || output.type === 'error-text') return { ...output, value: `${notice}\n\n${output.value}` }
	return output
}

function truncationNotice(truncation: AgentRunToolTruncation): string {
	const original = truncation.originalLines === null ? 'unknown original line count' : `${truncation.originalLines} original lines`
	const shown = truncation.outputLines === null ? 'stored output' : `${truncation.outputLines} stored lines`
	return `[Tool output truncated using ${truncation.strategy}: ${shown} from ${original}.]`
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { localStamp } = await import('../../utils/test-helpers')

	describe('buildAgentRunModelContext', () => {
		it('projects input, assistant, and tool transcript parts while filtering reasoning', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, {
						type: 'agent-run-model-use-override-changed',
						modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
						authorized: localStamp(),
					}),
					event(2, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						parts: [{ type: 'text', text: 'Hello', metadata: null }],
					}),
					event(3, {
						type: 'turn-started',
						contextThroughEventId: eventId(2),
						reason: { type: 'input', inputEventIds: [eventId(2)] },
					}),
					event(4, assistantMessageBody('Hi', 'call-1')),
					event(5, {
						type: 'tool-message',
						turnStartedEventId: eventId(3),
						respondsToAssistantMessageEventId: eventId(4),
						source: { type: 'tool-execution' },
						parts: [
							{
								type: 'tool-result',
								toolCallId: 'call-1',
								toolName: 'tool',
								providerExecuted: false,
								started: { at: '2026-06-10T12:00:00.000Z' },
								completed: { at: '2026-06-10T12:00:01.000Z' },
								output: { type: 'text', value: 'Done.' },
								truncation: null,
								metadata: null,
							},
						],
					}),
				],
				eventId(5),
			)

			expect(context.messages).toEqual([
				{ role: 'user', content: 'Hello' },
				{
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Hi' },
						{ type: 'tool-call', toolCallId: 'call-1', toolName: 'tool', input: {}, providerExecuted: false },
					],
				},
				{
					role: 'tool',
					content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'tool', output: { type: 'text', value: 'Done.' } }],
				},
			])
		})

		it('uses the latest compaction replacement as a context boundary', () => {
			const context = buildAgentRunModelContext(
				[
					event(1, {
						type: 'input-message',
						source: { type: 'runtime' },
						parts: [{ type: 'text', text: 'old', metadata: null }],
					}),
					event(2, {
						type: 'context-compacted',
						source: { type: 'runtime' },
						compactedThroughEventId: eventId(1),
						replacementParts: [{ type: 'text', text: 'summary', metadata: null }],
					}),
					event(3, {
						type: 'input-message',
						source: { type: 'operator', authorized: localStamp() },
						parts: [{ type: 'text', text: 'new', metadata: null }],
					}),
				],
				eventId(3),
			)

			expect(context.messages).toEqual([
				{ role: 'system', content: 'summary' },
				{ role: 'user', content: 'new' },
			])
		})
	})

	function event(index: number, body: AgentRunEvent['body']): AgentRunEvent {
		return {
			id: eventId(index),
			agentRunId: '01k00000000000000000000002',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body,
		}
	}

	function eventId(index: number): string {
		return `01k000000000000000000${index.toString().padStart(5, '0')}`
	}

	function assistantMessageBody(text: string, toolCallId: string): Extract<AgentRunEvent['body'], { type: 'assistant-message' }> {
		return {
			type: 'assistant-message',
			turnStartedEventId: eventId(3),
			model: {
				modelId: '01k00000000000000000000024',
				thinkingLevel: 'none',
				modelProviderId: '01k00000000000000000000032',
				providerProtocol: 'anthropic-messages',
				providerModelId: 'claude-sonnet',
			},
			finishReason: 'tool-calls',
			usage: {
				inputTokens: 10,
				inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: null, cacheWriteTokens: null },
				outputTokens: 5,
				outputTokenDetails: { textTokens: 5, reasoningTokens: null },
			},
			cost: null,
			responseId: null,
			parts: [
				{ type: 'reasoning', text: 'hidden from future context', metadata: null },
				{ type: 'text', text, metadata: null },
				{ type: 'tool-call', toolCallId, toolName: 'tool', input: {}, providerExecuted: false, metadata: null },
			],
		}
	}
}
