import { v, type PipeOutput } from 'valleyed'

import { agentRunPipe } from './agent-run'
import { agentRunEventPipe } from './agent-run-event'
import { freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe } from './commons'

const streamedTextPipe = v.string()

const assistantMessageDraftDeltaPipe = v.discriminate((delta) => delta.type, {
	'model-output-started': v.object({ type: v.eq('model-output-started') }),
	'text-started': v.object({ type: v.eq('text-started'), contentIndex: nonNegativeIntegerPipe }),
	'text-delta': v.object({ type: v.eq('text-delta'), contentIndex: nonNegativeIntegerPipe, delta: streamedTextPipe }),
	'text-ended': v.object({ type: v.eq('text-ended'), contentIndex: nonNegativeIntegerPipe, text: streamedTextPipe }),
	'thinking-started': v.object({ type: v.eq('thinking-started'), contentIndex: nonNegativeIntegerPipe }),
	'thinking-delta': v.object({ type: v.eq('thinking-delta'), contentIndex: nonNegativeIntegerPipe, delta: streamedTextPipe }),
	'thinking-ended': v.object({ type: v.eq('thinking-ended'), contentIndex: nonNegativeIntegerPipe, text: streamedTextPipe }),
	'tool-call-arguments-started': v.object({
		type: v.eq('tool-call-arguments-started'),
		contentIndex: nonNegativeIntegerPipe,
		toolCallId: nonEmptyTrimmedStringPipe,
		toolName: nonEmptyTrimmedStringPipe,
	}),
	'tool-call-arguments-ended': v.object({
		type: v.eq('tool-call-arguments-ended'),
		contentIndex: nonNegativeIntegerPipe,
		toolCallId: nonEmptyTrimmedStringPipe,
		toolName: nonEmptyTrimmedStringPipe,
		input: v.any<unknown>(),
	}),
	'model-output-ended': v.object({ type: v.eq('model-output-ended'), assistantMessageEventId: idPipe }),
	'model-output-discarded': v.object({ type: v.eq('model-output-discarded') }),
})
export type AssistantMessageDraftDelta = PipeOutput<typeof assistantMessageDraftDeltaPipe>

const toolCallUpdatePipe = v.discriminate((update) => update.type, {
	progress: v.object({
		type: v.eq('progress'),
		label: freeFormStringPipe,
		current: v.nullable(nonNegativeIntegerPipe),
		total: v.nullable(nonNegativeIntegerPipe),
	}),
	structured: v.object({ type: v.eq('structured'), value: v.any<unknown>() }),
})
export type ToolCallUpdate = PipeOutput<typeof toolCallUpdatePipe>

const notificationDataPipe = v.discriminate((data) => data.type, {
	'agent-run-created': v.object({ type: v.eq('agent-run-created'), agentRun: agentRunPipe }),
	'agent-run-updated': v.object({ type: v.eq('agent-run-updated'), agentRun: agentRunPipe }),
	'agent-run-event-created': v.object({ type: v.eq('agent-run-event-created'), event: agentRunEventPipe }),
	'assistant-message-draft-updated': v.object({
		type: v.eq('assistant-message-draft-updated'),
		agentRunId: idPipe,
		turnStartedEventId: idPipe,
		draftId: nonEmptyTrimmedStringPipe,
		delta: assistantMessageDraftDeltaPipe,
	}),
	'tool-call-updated': v.object({
		type: v.eq('tool-call-updated'),
		agentRunId: idPipe,
		turnStartedEventId: idPipe,
		toolCallId: nonEmptyTrimmedStringPipe,
		update: toolCallUpdatePipe,
	}),
})

export const notificationPipe = v.object({ id: idPipe, data: notificationDataPipe })
export type Notification = PipeOutput<typeof notificationPipe>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { testModelAgentRun } = await import('../utils/test-helpers')

	describe('notificationPipe', () => {
		it('accepts an Agent Run creation notification with the complete Agent Run', () => {
			expect(
				v.validate(notificationPipe, {
					id: '01k00000000000000000000001',
					data: { type: 'agent-run-created', agentRun: testModelAgentRun() },
				}),
			).toMatchObject({ valid: true })
		})

		it('accepts durable Agent Run update and Agent Run Event creation notifications', () => {
			const agentRun = testModelAgentRun()
			const event = {
				id: '01k00000000000000000000003',
				agentRunId: agentRun.id,
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'instruction-snapshot',
					instruction: { type: 'source-control-planning', version: 1 },
					parts: [{ type: 'text', text: 'Plan.', metadata: null }],
				},
			}
			expect(
				['agent-run-updated', 'agent-run-event-created'].map((type) =>
					v.validate(notificationPipe, {
						id: '01k00000000000000000000001',
						data: type === 'agent-run-updated' ? { type, agentRun } : { type, event },
					}),
				),
			).toEqual([expect.objectContaining({ valid: true }), expect.objectContaining({ valid: true })])
		})

		it('accepts Agent Run-scoped assistant draft and tool-call live notifications', () => {
			const scope = {
				agentRunId: '01k00000000000000000000002',
				turnStartedEventId: '01k00000000000000000000003',
			}
			expect(
				[
					{
						type: 'assistant-message-draft-updated',
						...scope,
						draftId: 'ai-sdk-call:call-1',
						delta: { type: 'model-output-started' },
					},
					{
						type: 'tool-call-updated',
						...scope,
						toolCallId: 'tool-1',
						update: { type: 'progress', label: 'Running', current: 1, total: 2 },
					},
				].map((data) => v.validate(notificationPipe, { id: '01k00000000000000000000001', data })),
			).toEqual([expect.objectContaining({ valid: true }), expect.objectContaining({ valid: true })])
		})

		it('accepts every safe assistant draft delta and structured tool update', () => {
			const content = { contentIndex: 0 }
			const deltas = [
				{ type: 'text-started', ...content },
				{ type: 'text-delta', ...content, delta: 'Hello' },
				{ type: 'text-ended', ...content, text: 'Hello' },
				{ type: 'thinking-started', ...content },
				{ type: 'thinking-delta', ...content, delta: 'Consider' },
				{ type: 'thinking-ended', ...content, text: 'Consider' },
				{ type: 'tool-call-arguments-started', ...content, toolCallId: 'tool-1', toolName: 'read' },
				{
					type: 'tool-call-arguments-ended',
					...content,
					toolCallId: 'tool-1',
					toolName: 'read',
					input: { path: '[REDACTED]' },
				},
				{ type: 'model-output-ended', assistantMessageEventId: '01k00000000000000000000004' },
				{ type: 'model-output-discarded' },
			]
			expect(
				deltas.every(
					(delta) =>
						v.validate(notificationPipe, {
							id: '01k00000000000000000000001',
							data: {
								type: 'assistant-message-draft-updated',
								agentRunId: '01k00000000000000000000002',
								turnStartedEventId: '01k00000000000000000000003',
								draftId: 'ai-sdk-call:call-1',
								delta,
							},
						}).valid,
				),
			).toBe(true)

			expect(
				v.validate(notificationPipe, {
					id: '01k00000000000000000000001',
					data: {
						type: 'tool-call-updated',
						agentRunId: '01k00000000000000000000002',
						turnStartedEventId: '01k00000000000000000000003',
						toolCallId: 'tool-1',
						update: { type: 'structured', value: { token: '[REDACTED]' } },
					},
				}),
			).toMatchObject({ valid: true })
		})

		it('preserves streamed text and thinking whitespace exactly', () => {
			const value = v.assert(notificationPipe, {
				id: '01k00000000000000000000001',
				data: {
					type: 'assistant-message-draft-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000003',
					draftId: 'ai-sdk-call:call-1',
					delta: { type: 'text-delta', contentIndex: 0, delta: ' hello ' },
				},
			})

			expect(value.data.type === 'assistant-message-draft-updated' ? value.data.delta : null).toEqual({
				type: 'text-delta',
				contentIndex: 0,
				delta: ' hello ',
			})
		})

		it('rejects unsafe, unscoped, unlinked, and invalidly identified notifications', () => {
			const assistantData = {
				type: 'assistant-message-draft-updated',
				turnStartedEventId: '01k00000000000000000000003',
				draftId: 'ai-sdk-call:call-1',
			}
			const toolData = {
				type: 'tool-call-updated',
				agentRunId: '01k00000000000000000000002',
				turnStartedEventId: '01k00000000000000000000003',
				toolCallId: 'tool-1',
			}
			const invalid = [
				{
					id: 'invalid',
					data: { ...assistantData, agentRunId: '01k00000000000000000000002', delta: { type: 'model-output-started' } },
				},
				{ id: '01k00000000000000000000001', data: { ...assistantData, delta: { type: 'model-output-started' } } },
				{
					id: '01k00000000000000000000001',
					data: { ...assistantData, agentRunId: '01k00000000000000000000002', delta: { type: 'model-output-ended' } },
				},
				{
					id: '01k00000000000000000000001',
					data: {
						...assistantData,
						agentRunId: '01k00000000000000000000002',
						delta: { type: 'tool-call-arguments-delta', contentIndex: 0, toolCallId: 'tool-1', delta: '{' },
					},
				},
				{ id: '01k00000000000000000000001', data: { ...toolData, update: { type: 'text-delta', delta: 'unsafe' } } },
			]
			expect(invalid.map((value) => v.validate(notificationPipe, value).valid)).toEqual(invalid.map(() => false))
		})
	})
}
