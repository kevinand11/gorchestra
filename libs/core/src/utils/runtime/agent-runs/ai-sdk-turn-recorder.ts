import {
	tool as aiTool,
	jsonSchema,
	type ContentPart,
	type LanguageModelCallEndEvent,
	type TextStreamPart,
	type ToolExecutionOptions,
	type ToolSet,
} from 'ai'

import { recordToolProposal } from './tool-proposals'
import { providerTool, toolOutput, validateToolInput, type CoreAgentRunToolDefinition } from './tools'
import { AgentRunToolExecutionCoordinator } from './tools/coordinator'
import { AgentRunToolExecutionFailed } from './tools/results'
import { assistantMessageModel, assistantPartsFromAIContent, toAISDKToolOutput } from './transcript-parts'
import type { TurnModelUse } from './turn-model-use'
import type { AgentRunLoopState, AgentRunRuntimeError, ModelAgentRunRuntime, RunModelAgentRunOptions } from './types'
import { costFromUsage, usageFromAIUsage } from './usage-cost'
import type {
	AgentRunAssistantTranscriptPart,
	AgentRunEvent,
	AgentRunToolOutput,
	AgentRunToolTranscriptPart,
} from '../../../domain/agent-run-event'
import type { Id, RuntimeRecord } from '../../../domain/commons'
import type { AssistantMessageDraftDelta, ToolCallUpdate } from '../../../domain/notifications'
import { appendAgentRunEvent } from '../../agent-runs'
import { runtimeRecord, type CoreRuntimeValues } from '../../runtime-values'
import type { Result } from '../../types'

type RecordedToolPart =
	| Extract<AgentRunToolTranscriptPart, { type: 'tool-result' }>
	| Extract<AgentRunToolTranscriptPart, { type: 'tool-error' }>

type PendingToolGroup = {
	assistantMessageEventId: Id
	turnStartedEventId: Id
	orderedToolCallIds: string[]
	partsByToolCallId: Map<string, RecordedToolPart>
}

export class AISDKTurnRecorder {
	readonly #draftIdByCallId = new Map<string, string>()
	readonly #contentIndexByPartId = new Map<string, number>()
	readonly #textByPartId = new Map<string, string>()
	readonly #pendingToolGroupByToolCallId = new Map<string, PendingToolGroup>()
	readonly #coordinator = new AgentRunToolExecutionCoordinator()
	#currentDraftId: string | null = null
	#error: AgentRunRuntimeError | null = null
	#nextContentIndex = 0

	constructor(
		private readonly runtime: ModelAgentRunRuntime,
		private readonly state: AgentRunLoopState,
		private readonly turnStarted: AgentRunEvent,
		private readonly turnModelUse: TurnModelUse,
		private readonly options: RunModelAgentRunOptions,
	) {}

	operationError(): AgentRunRuntimeError | null {
		return this.#error
	}

	tools(): ToolSet {
		return Object.fromEntries(this.state.tools.map((coreTool) => [coreTool.name, this.aiTool(coreTool)]))
	}

	onLanguageModelCallStart(callId: string): Promise<void> {
		this.#currentDraftId = draftIdForCallId(callId)
		this.#draftIdByCallId.set(callId, this.#currentDraftId)
		this.#contentIndexByPartId.clear()
		this.#textByPartId.clear()
		this.#nextContentIndex = 0
		this.runtime.notifications.emit({
			type: 'assistant-message-draft-updated',
			agentRunId: this.state.agentRun.id,
			turnStartedEventId: this.turnStarted.id,
			draftId: this.#currentDraftId,
			delta: { type: 'model-output-started' },
		})
		return Promise.resolve()
	}

	async onLanguageModelCallEnd(event: LanguageModelCallEndEvent<ToolSet>): Promise<void> {
		const usage = usageFromAIUsage(event.usage)
		const parts = await this.redactedAssistantPartsFromAIContent(event.content)
		const assistant = await appendAgentRunEvent(this.runtime, this.runtime.services.storage, this.state.agentRun.id, {
			type: 'assistant-message',
			turnStartedEventId: this.turnStarted.id,
			model: assistantMessageModel(this.turnModelUse),
			finishReason: event.finishReason,
			usage,
			cost: costFromUsage(usage, this.turnModelUse.model.pricing),
			responseId: event.responseId.length === 0 ? null : event.responseId,
			parts,
		})
		if (!assistant.ok) return this.fail(assistant.error)

		if (assistant.value.body.type !== 'assistant-message') throw new Error('Expected assistant-message event body after append.')
		this.registerPendingToolCalls(assistant.value as AgentRunEventWithBody<'assistant-message'>)
		const draftId = this.#draftIdByCallId.get(event.callId)
		if (draftId !== undefined) {
			this.runtime.notifications.emit({
				type: 'assistant-message-draft-updated',
				agentRunId: this.state.agentRun.id,
				turnStartedEventId: this.turnStarted.id,
				draftId,
				delta: { type: 'model-output-ended', assistantMessageEventId: assistant.value.id },
			})
			this.#draftIdByCallId.delete(event.callId)
			if (this.#currentDraftId === draftId) this.#currentDraftId = null
		}
	}

	async onChunk(chunk: TextStreamPart<ToolSet>): Promise<void> {
		const draftId = this.#currentDraftId
		if (draftId === null) return

		switch (chunk.type) {
			case 'text-start':
				this.startPart(chunk.id)
				this.emitModelDelta(draftId, { type: 'text-started', contentIndex: this.indexForPart(chunk.id) })
				return
			case 'text-delta':
				this.appendPartText(chunk.id, chunk.text)
				this.emitModelDelta(draftId, { type: 'text-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text })
				return
			case 'text-end':
				this.emitModelDelta(draftId, {
					type: 'text-ended',
					contentIndex: this.indexForPart(chunk.id),
					text: this.#textByPartId.get(chunk.id) ?? '',
				})
				return
			case 'reasoning-start':
				this.startPart(chunk.id)
				this.emitModelDelta(draftId, { type: 'thinking-started', contentIndex: this.indexForPart(chunk.id) })
				return
			case 'reasoning-delta':
				this.appendPartText(chunk.id, chunk.text)
				this.emitModelDelta(draftId, { type: 'thinking-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text })
				return
			case 'reasoning-end':
				this.emitModelDelta(draftId, {
					type: 'thinking-ended',
					contentIndex: this.indexForPart(chunk.id),
					text: this.#textByPartId.get(chunk.id) ?? '',
				})
				return
			case 'tool-input-start':
				this.startPart(chunk.id)
				this.emitModelDelta(draftId, {
					type: 'tool-call-arguments-started',
					contentIndex: this.indexForPart(chunk.id),
					toolCallId: chunk.id,
					toolName: chunk.toolName,
				})
				return
			case 'tool-input-delta':
				return
			case 'tool-call': {
				const input = await this.state.sandbox.redactJson({ value: chunk.input })
				if (!input.ok) return
				this.emitModelDelta(draftId, {
					type: 'tool-call-arguments-ended',
					contentIndex: this.indexForPart(chunk.toolCallId),
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: input.value,
				})
				return
			}
			default:
				return
		}
	}

	recordUnclosedModelFailure(_error: unknown, _signal: AbortSignal | undefined): Result<void, AgentRunRuntimeError> {
		this.discardCurrentDraft()
		return { ok: true, value: undefined }
	}

	private emitModelDelta(draftId: string, delta: AssistantMessageDraftDelta): void {
		this.runtime.notifications.emit({
			type: 'assistant-message-draft-updated',
			agentRunId: this.state.agentRun.id,
			turnStartedEventId: this.turnStarted.id,
			draftId,
			delta,
		})
	}

	private async redactedAssistantPartsFromAIContent(
		content: ReadonlyArray<ContentPart<ToolSet>>,
	): Promise<AgentRunAssistantTranscriptPart[]> {
		const parts = assistantPartsFromAIContent(content)
		const redactedParts: AgentRunAssistantTranscriptPart[] = []
		for (const part of parts) {
			if (part.type !== 'tool-call') {
				redactedParts.push(part)
				continue
			}
			const redacted = await this.state.sandbox.redactJson({ value: part.input })
			if (!redacted.ok) this.fail(redacted.error)
			redactedParts.push({ ...part, input: redacted.value })
		}
		return redactedParts
	}

	private registerPendingToolCalls(assistant: AgentRunEventWithBody<'assistant-message'>): void {
		const toolCallIds = assistant.body.parts.flatMap((part) =>
			part.type === 'tool-call' && part.providerExecuted === false ? [part.toolCallId] : [],
		)
		if (toolCallIds.length === 0) return

		const group: PendingToolGroup = {
			assistantMessageEventId: assistant.id,
			turnStartedEventId: this.turnStarted.id,
			orderedToolCallIds: toolCallIds,
			partsByToolCallId: new Map(),
		}
		for (const toolCallId of toolCallIds) this.#pendingToolGroupByToolCallId.set(toolCallId, group)
	}

	private aiTool(coreTool: CoreAgentRunToolDefinition) {
		const exposed = providerTool(coreTool)
		return aiTool<unknown, AgentRunToolOutput, Record<string, unknown>>({
			description: exposed.description,
			inputSchema: jsonSchema<unknown>(exposed.parameters as never),
			execute: (input, execution) => this.executeTool(coreTool, input, execution),
			toModelOutput: ({ output }) => toAISDKToolOutput(output.output) as never,
		})
	}

	private async executeTool(
		coreTool: CoreAgentRunToolDefinition,
		input: unknown,
		execution: ToolExecutionOptions<Record<string, unknown>>,
	): Promise<AgentRunToolOutput> {
		const group = this.#pendingToolGroupByToolCallId.get(execution.toolCallId)
		if (group === undefined) return toolOutput('Tool call could not be recorded because assistant message context is missing.')

		const started = runtimeRecord(this.runtime.values)
		if (!started.ok) return this.failTool(started.error)

		const validated = validateToolInput(coreTool, input)
		if (!validated.ok) {
			const output = toolOutput('Tool call input failed validation.')
			return this.recordToolPart(
				group,
				invalidToolInputPart(
					coreTool.name,
					execution.toolCallId,
					started.value,
					runtimeRecordOrSame(this.runtime.values, started.value),
					output,
				),
			)
		}

		const mutationKey = this.mutationKeyForTool(coreTool, validated.value)
		if (!mutationKey.ok) {
			return this.recordToolPart(
				group,
				invalidToolInputPart(
					coreTool.name,
					execution.toolCallId,
					started.value,
					runtimeRecordOrSame(this.runtime.values, started.value),
					mutationKey.error,
				),
			)
		}

		try {
			const execute = () =>
				coreTool.execute(validated.value, {
					agentRunId: this.state.agentRun.id,
					assistantMessageEventId: group.assistantMessageEventId,
					toolCallId: execution.toolCallId,
					signal: execution.abortSignal ?? this.options.signal ?? new AbortController().signal,
					onUpdate: (update) => this.publishToolUpdate(execution.toolCallId, update),
					recordProposal: (body) =>
						recordToolProposal(this.runtime, this.state.agentRun.id, group.assistantMessageEventId, execution.toolCallId, body),
					sandbox: this.state.sandbox,
				})
			const output = await this.coordinatedToolExecution(coreTool, mutationKey.value, execute)
			const completed = runtimeRecordOrSame(this.runtime.values, started.value)
			return this.recordToolPart(group, {
				type: 'tool-result',
				toolCallId: execution.toolCallId,
				toolName: coreTool.name,
				providerExecuted: false,
				started: started.value,
				completed,
				output: output.output,
				truncation: output.truncation,
				metadata: null,
			})
		} catch (error) {
			const output = error instanceof AgentRunToolExecutionFailed ? error.output : toolOutput('Tool execution failed.')
			return this.recordToolPart(group, {
				type: 'tool-error',
				toolCallId: execution.toolCallId,
				toolName: coreTool.name,
				providerExecuted: false,
				started: started.value,
				completed: runtimeRecordOrSame(this.runtime.values, started.value),
				reason: error instanceof AgentRunToolExecutionFailed ? error.reason : { type: 'tool-runtime-error' },
				error: output.output,
				truncation: output.truncation,
				metadata: null,
			})
		}
	}

	private async publishToolUpdate(toolCallId: string, update: ToolCallUpdate): Promise<void> {
		switch (update.type) {
			case 'progress':
				this.runtime.notifications.emit({
					type: 'tool-call-updated',
					agentRunId: this.state.agentRun.id,
					turnStartedEventId: this.turnStarted.id,
					toolCallId,
					update,
				})
				return
			case 'structured': {
				const redacted = await this.state.sandbox.redactJson({ value: update.value })
				if (!redacted.ok) return
				this.runtime.notifications.emit({
					type: 'tool-call-updated',
					agentRunId: this.state.agentRun.id,
					turnStartedEventId: this.turnStarted.id,
					toolCallId,
					update: { type: 'structured', value: redacted.value },
				})
				return
			}
			default:
				throw new Error(`Unexpected Tool Call Update type: ${String(update satisfies never)}`)
		}
	}

	private mutationKeyForTool(tool: CoreAgentRunToolDefinition, input: unknown): Result<string | null, AgentRunToolOutput> {
		switch (tool.workspaceMutationKind) {
			case 'read-only':
			case 'global-mutator':
				return { ok: true, value: null }
			case 'file-mutator': {
				if (tool.workspaceMutationKey === undefined)
					return { ok: false, error: toolOutput('Tool mutation target failed validation.') }
				const key = tool.workspaceMutationKey(input)
				if (!key.ok) return key
				return key.value.length === 0 ? { ok: false, error: toolOutput('Tool mutation target failed validation.') } : key
			}
			default:
				throw new Error(`Unexpected workspace mutation kind: ${String(tool.workspaceMutationKind satisfies never)}`)
		}
	}

	private coordinatedToolExecution(
		tool: CoreAgentRunToolDefinition,
		mutationKey: string | null,
		execute: () => Promise<AgentRunToolOutput>,
	): Promise<AgentRunToolOutput> {
		switch (tool.workspaceMutationKind) {
			case 'read-only':
				return this.#coordinator.run({ workspaceMutationKind: 'read-only', execute })
			case 'file-mutator':
				if (mutationKey === null) throw new Error('Expected file-mutator mutation key.')
				return this.#coordinator.run({ workspaceMutationKind: 'file-mutator', mutationKey, execute })
			case 'global-mutator':
				return this.#coordinator.run({ workspaceMutationKind: 'global-mutator', execute })
			default:
				throw new Error(`Unexpected workspace mutation kind: ${String(tool.workspaceMutationKind satisfies never)}`)
		}
	}

	private async recordToolPart(group: PendingToolGroup, part: RecordedToolPart): Promise<AgentRunToolOutput> {
		group.partsByToolCallId.set(part.toolCallId, part)
		await this.maybeAppendToolMessage(group)
		return part.type === 'tool-result'
			? { output: part.output, truncation: part.truncation }
			: { output: part.error, truncation: part.truncation }
	}

	private async maybeAppendToolMessage(group: PendingToolGroup): Promise<void> {
		if (group.partsByToolCallId.size !== group.orderedToolCallIds.length) return
		const parts = group.orderedToolCallIds.map((toolCallId) => group.partsByToolCallId.get(toolCallId)!)
		const event = await appendAgentRunEvent(this.runtime, this.runtime.services.storage, this.state.agentRun.id, {
			type: 'tool-message',
			turnStartedEventId: group.turnStartedEventId,
			respondsToAssistantMessageEventId: group.assistantMessageEventId,
			source: { type: 'tool-execution' },
			parts,
		})
		if (!event.ok) this.fail(event.error)
		for (const toolCallId of group.orderedToolCallIds) this.#pendingToolGroupByToolCallId.delete(toolCallId)
	}

	private fail(error: AgentRunRuntimeError): never {
		this.discardCurrentDraft()
		this.#error = error
		throw new Error(`Agent Run transcript persistence failed: ${error.type}`)
	}

	private discardCurrentDraft(): void {
		const draftId = this.#currentDraftId
		if (draftId === null) return

		this.runtime.notifications.emit({
			type: 'assistant-message-draft-updated',
			agentRunId: this.state.agentRun.id,
			turnStartedEventId: this.turnStarted.id,
			draftId,
			delta: { type: 'model-output-discarded' },
		})
		for (const [callId, candidate] of this.#draftIdByCallId) {
			if (candidate === draftId) this.#draftIdByCallId.delete(callId)
		}
		this.#currentDraftId = null
	}

	private failTool(error: AgentRunRuntimeError): AgentRunToolOutput {
		this.#error = error
		throw new Error(`Agent Run tool transcript persistence failed: ${error.type}`)
	}

	private startPart(partId: string): void {
		if (!this.#contentIndexByPartId.has(partId)) {
			this.#contentIndexByPartId.set(partId, this.#nextContentIndex)
			this.#nextContentIndex += 1
		}
	}

	private indexForPart(partId: string): number {
		this.startPart(partId)
		return this.#contentIndexByPartId.get(partId)!
	}

	private appendPartText(partId: string, delta: string): void {
		this.#textByPartId.set(partId, `${this.#textByPartId.get(partId) ?? ''}${delta}`)
	}
}

function draftIdForCallId(callId: string): string {
	return `ai-sdk-call:${callId}`
}

type AgentRunEventWithBody<TType extends AgentRunEvent['body']['type']> = AgentRunEvent & {
	body: Extract<AgentRunEvent['body'], { type: TType }>
}

function invalidToolInputPart(
	toolName: string,
	toolCallId: string,
	started: RuntimeRecord,
	completed: RuntimeRecord,
	output: AgentRunToolOutput,
): RecordedToolPart {
	return {
		type: 'tool-error',
		toolCallId,
		toolName,
		providerExecuted: false,
		started,
		completed,
		reason: { type: 'invalid-input' },
		error: output.output,
		truncation: output.truncation,
		metadata: null,
	}
}

function runtimeRecordOrSame(values: CoreRuntimeValues, fallback: RuntimeRecord): RuntimeRecord {
	const record = runtimeRecord(values)
	return record.ok ? record.value : fallback
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { v } = await import('valleyed')
	const { defaultModelCapabilities } = await import('../../../domain/model')
	const { createTestCoreRuntime, createTestCoreServices, testModelAgentRun } = await import('../../test-helpers')

	describe('AISDKTurnRecorder', () => {
		it('publishes an Agent Run-scoped Assistant Message Draft start', async () => {
			const fixture = recorderFixture({})

			await fixture.recorder.onLanguageModelCallStart('call-1')

			expect(fixture.notifications).toEqual([
				{
					id: '01k00000000000000000010001',
					data: {
						type: 'assistant-message-draft-updated',
						agentRunId: '01k00000000000000000000002',
						turnStartedEventId: '01k00000000000000000000010',
						draftId: 'ai-sdk-call:call-1',
						delta: { type: 'model-output-started' },
					},
				},
			])
		})

		it('publishes safe assistant deltas in source order while omitting raw tool argument deltas', async () => {
			const fixture = recorderFixture({ redactedValue: { token: '[REDACTED]' } })
			await fixture.recorder.onLanguageModelCallStart('call-1')
			fixture.notifications.length = 0

			await fixture.recorder.onChunk({ type: 'text-start', id: 'text-1' })
			await fixture.recorder.onChunk({ type: 'text-delta', id: 'text-1', text: 'Hello' })
			await fixture.recorder.onChunk({ type: 'text-end', id: 'text-1' })
			await fixture.recorder.onChunk({
				type: 'tool-input-start',
				id: 'tool-call-1',
				toolName: 'sample-tool',
			})
			await fixture.recorder.onChunk({
				type: 'tool-input-delta',
				id: 'tool-call-1',
				delta: '{"token":"secret"}',
			})
			await fixture.recorder.onChunk({
				type: 'tool-call',
				toolCallId: 'tool-call-1',
				toolName: 'sample-tool',
				input: { token: 'secret' },
			})

			expect(
				fixture.notifications.map((notification) => (notification as { data: { type: string; delta?: unknown } }).data.delta),
			).toEqual([
				{ type: 'text-started', contentIndex: 0 },
				{ type: 'text-delta', contentIndex: 0, delta: 'Hello' },
				{ type: 'text-ended', contentIndex: 0, text: 'Hello' },
				{ type: 'tool-call-arguments-started', contentIndex: 1, toolCallId: 'tool-call-1', toolName: 'sample-tool' },
				{
					type: 'tool-call-arguments-ended',
					contentIndex: 1,
					toolCallId: 'tool-call-1',
					toolName: 'sample-tool',
					input: { token: '[REDACTED]' },
				},
			])
			expect(fixture.notifications.map((notification) => (notification as { data: { agentRunId: string } }).data.agentRunId)).toEqual(
				fixture.notifications.map(() => '01k00000000000000000000002'),
			)
		})

		it('drops an unredactable live tool input without failing model execution', async () => {
			const fixture = recorderFixture({ redactionFails: true })
			await fixture.recorder.onLanguageModelCallStart('call-1')
			fixture.notifications.length = 0

			await expect(
				fixture.recorder.onChunk({
					type: 'tool-call',
					toolCallId: 'tool-call-1',
					toolName: 'sample-tool',
					input: { token: 'secret' },
				}),
			).resolves.toBeUndefined()
			expect(fixture.recorder.operationError()).toBeNull()
			expect(fixture.notifications).toEqual([])
		})

		it('publishes the durable assistant event before ending its Assistant Message Draft', async () => {
			const fixture = recorderFixture({ redactedValue: { token: '[REDACTED]' } })
			await fixture.recorder.onLanguageModelCallStart('call-1')
			fixture.notifications.length = 0

			await fixture.recorder.onLanguageModelCallEnd(languageModelCallEndEvent({ token: 'secret-token' }))

			const notifications = fixture.notifications as Array<{
				id: string
				data: { type: string; event?: AgentRunEvent; delta?: { type: string; assistantMessageEventId?: string } }
			}>
			expect(notifications.map((notification) => notification.data.type)).toEqual([
				'agent-run-event-created',
				'assistant-message-draft-updated',
			])
			expect(notifications[1]).toEqual({
				id: '01k00000000000000000010004',
				data: {
					type: 'assistant-message-draft-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000010',
					draftId: 'ai-sdk-call:call-1',
					delta: { type: 'model-output-ended', assistantMessageEventId: notifications[0]?.data.event?.id },
				},
			})
		})

		it('redacts persisted assistant tool-call inputs while keeping execution context pending', async () => {
			const fixture = recorderFixture({ redactedValue: { token: '[REDACTED]' } })

			await fixture.recorder.onLanguageModelCallEnd(languageModelCallEndEvent({ token: 'secret-token' }))

			const assistant = [...fixture.services.tx.agentRunEvents.records.values()].find(
				(event) => event.body.type === 'assistant-message',
			)
			expect(assistant?.body).toMatchObject({
				type: 'assistant-message',
				parts: [{ type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'sample-tool', input: { token: '[REDACTED]' } }],
			})
			expect(fixture.recorder.operationError()).toBeNull()
		})

		it('publishes redacted progress and structured Tool Call updates', async () => {
			const coreTool: CoreAgentRunToolDefinition = {
				name: 'sample-tool',
				contractVersion: 1,
				description: 'Sample tool.',
				inputPipe: v.any<unknown>(),
				promptSnippet: 'Use sample tool',
				promptGuidelines: [],
				workspaceMutationKind: 'read-only',
				execute: async (_input, context) => {
					await context.onUpdate({ type: 'progress', label: 'Running', current: 1, total: 2 })
					await context.onUpdate({ type: 'structured', value: { token: 'secret' } })
					return toolOutput('done')
				},
			}
			const fixture = recorderFixture({ redactedValue: { token: '[REDACTED]' }, tools: [coreTool] })
			await fixture.recorder.onLanguageModelCallStart('call-1')
			await fixture.recorder.onLanguageModelCallEnd(languageModelCallEndEvent({ token: 'secret-token' }))
			fixture.notifications.length = 0
			const providerTool = fixture.recorder.tools()['sample-tool'] as {
				execute(input: unknown, options: ToolExecutionOptions<Record<string, unknown>>): Promise<AgentRunToolOutput>
			}

			await providerTool.execute({}, {
				toolCallId: 'tool-call-1',
				messages: [],
				abortSignal: undefined,
			} as unknown as ToolExecutionOptions<Record<string, unknown>>)

			expect(
				fixture.notifications
					.map((notification) => (notification as { data: { type: string; update?: unknown } }).data)
					.filter((data) => data.type === 'tool-call-updated'),
			).toEqual([
				{
					type: 'tool-call-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000010',
					toolCallId: 'tool-call-1',
					update: { type: 'progress', label: 'Running', current: 1, total: 2 },
				},
				{
					type: 'tool-call-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000010',
					toolCallId: 'tool-call-1',
					update: { type: 'structured', value: { token: '[REDACTED]' } },
				},
			])
		})

		it('discards an unclosed Assistant Message Draft exactly once after model failure', async () => {
			const fixture = recorderFixture({})
			await fixture.recorder.onLanguageModelCallStart('call-1')
			fixture.notifications.length = 0

			expect(fixture.recorder.recordUnclosedModelFailure(new Error('provider failed'), undefined)).toEqual({
				ok: true,
				value: undefined,
			})
			fixture.recorder.recordUnclosedModelFailure(new Error('provider failed again'), undefined)

			expect(fixture.notifications.map((notification) => (notification as { data: { delta?: unknown } }).data.delta)).toEqual([
				{ type: 'model-output-discarded' },
			])
		})

		it('fails closed and discards the draft before persisting an assistant message when redaction fails', async () => {
			const fixture = recorderFixture({ redactionFails: true })
			await fixture.recorder.onLanguageModelCallStart('call-1')
			fixture.notifications.length = 0

			await expect(fixture.recorder.onLanguageModelCallEnd(languageModelCallEndEvent({ token: 'secret-token' }))).rejects.toThrow(
				'Agent Run transcript persistence failed: sandbox-operation-failed',
			)

			expect(fixture.recorder.operationError()).toEqual({
				type: 'sandbox-operation-failed',
				operation: 'read-file',
				summary: 'Redaction failed.',
			})
			expect([...fixture.services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'assistant-message')).toBe(
				false,
			)
			expect(fixture.notifications.map((notification) => (notification as { data: { delta?: unknown } }).data.delta)).toEqual([
				{ type: 'model-output-discarded' },
			])
		})
	})

	function recorderFixture(input: { redactedValue?: unknown; redactionFails?: boolean; tools?: CoreAgentRunToolDefinition[] }) {
		const agentRunId = '01k00000000000000000000002'
		const notifications: unknown[] = []
		const services = createTestCoreServices({ notifications: { publish: (notification) => notifications.push(notification) } })
		const agentRun = {
			...testModelAgentRun({ id: agentRunId }),
			blocked: null,
			sandbox: {
				key: agentRunId,
				created: { at: '2026-06-10T12:00:00.000Z' },
				appliedRequirements: [],
				appliedThroughEventId: null,
				released: null,
			},
		}
		services.tx.agentRuns.records.set(agentRunId, agentRun)
		const runtime = createTestCoreRuntime(services)
		const turnStarted: AgentRunEvent = {
			id: '01k00000000000000000000010',
			agentRunId,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'turn-started',
				contextThroughEventId: '01k00000000000000000000009',
				reason: { type: 'input', inputEventIds: ['01k00000000000000000000009'] },
			},
		}
		const recorder = new AISDKTurnRecorder(
			runtime,
			{ agentRun, events: [turnStarted], tools: input.tools ?? [], sandbox: testManagedSandbox(input) },
			turnStarted,
			{
				model: {
					id: '01k00000000000000000000024',
					providerId: '01k00000000000000000000032',
					name: 'Model',
					providerModelId: 'model',
					providerOptions: null,
					capabilities: defaultModelCapabilities,
					pricing: null,
					created: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' },
					updated: null,
					archivePeriods: [],
				},
				modelProvider: {
					id: '01k00000000000000000000032',
					name: 'Provider',
					source: { type: 'anthropic' },
					auth: null,
					headers: [],
					providerOptions: null,
					created: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' },
					updated: null,
					archivePeriods: [],
				},
				thinking: null,
			},
			{},
		)
		return { recorder, services, notifications }
	}

	function testManagedSandbox(input: { redactedValue?: unknown; redactionFails?: boolean }) {
		return {
			setEnv: () => Promise.resolve({ ok: true as const, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			runCommand: () => Promise.resolve({ ok: true as const, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			readFile: () => Promise.resolve({ ok: true as const, value: null }),
			writeFile: () => Promise.resolve({ ok: true as const, value: undefined }),
			listDirectory: () => Promise.resolve({ ok: true as const, value: null }),
			deletePath: () => Promise.resolve({ ok: true as const, value: undefined }),
			redactText: ({ text }: { text: string }) => Promise.resolve({ ok: true as const, value: text }),
			redactJson: () =>
				input.redactionFails === true
					? Promise.resolve({
							ok: false as const,
							error: {
								type: 'sandbox-operation-failed' as const,
								operation: 'read-file' as const,
								summary: 'Redaction failed.',
							},
						})
					: Promise.resolve({ ok: true as const, value: input.redactedValue }),
			release: () => Promise.resolve({ ok: true as const, value: { summary: 'released' } }),
		}
	}

	function languageModelCallEndEvent(input: unknown): LanguageModelCallEndEvent<ToolSet> {
		return {
			callId: 'call-1',
			responseId: 'response-1',
			finishReason: 'tool-calls',
			usage: {
				inputTokens: 1,
				inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: undefined, cacheWriteTokens: undefined },
				outputTokens: 1,
				outputTokenDetails: { textTokens: 1, reasoningTokens: undefined },
			},
			content: [
				{
					type: 'tool-call',
					toolCallId: 'tool-call-1',
					toolName: 'sample-tool',
					input,
					providerExecuted: false,
				},
			],
		} as unknown as LanguageModelCallEndEvent<ToolSet>
	}
}
