import {
	tool as aiTool,
	jsonSchema,
	type LanguageModelCallEndEvent,
	type TextStreamPart,
	type ToolExecutionOptions,
	type ToolSet,
} from 'ai'

import { appendAndEmit, emit } from './event-emission'
import type { AgentRunModelDelta } from './live-events'
import { recordToolProposal } from './tool-proposals'
import { providerTool, toolOutput, validateToolInput, type CoreAgentRunTool } from './tools'
import { assistantMessageModel, assistantPartsFromAIContent, toAISDKToolOutput } from './transcript-parts'
import type { TurnModelUse } from './turn-model-use'
import type { AgentRunLoopState, AgentRunRuntimeError, ModelAgentRunRuntime, RunModelAgentRunOptions } from './types'
import { costFromUsage, usageFromAIUsage } from './usage-cost'
import type { AgentRunEvent, AgentRunToolOutput, AgentRunToolTranscriptPart } from '../../domain/agent-run'
import type { Id, RuntimeRecord } from '../../domain/commons'
import { runtimeRecord, type CoreRuntimeValues } from '../../utils/runtime-values'
import type { Result } from '../../utils/types'

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

	async onLanguageModelCallStart(callId: string): Promise<void> {
		this.#currentDraftId = draftIdForCallId(callId)
		this.#draftIdByCallId.set(callId, this.#currentDraftId)
		this.#contentIndexByPartId.clear()
		this.#textByPartId.clear()
		this.#nextContentIndex = 0
		await emit(this.options, {
			type: 'assistant-message-draft-updated',
			turnStartedEventId: this.turnStarted.id,
			draftId: this.#currentDraftId,
			delta: { type: 'model-output-started' },
		})
	}

	async onLanguageModelCallEnd(event: LanguageModelCallEndEvent<ToolSet>): Promise<void> {
		const usage = usageFromAIUsage(event.usage)
		const assistant = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{
				type: 'assistant-message',
				turnStartedEventId: this.turnStarted.id,
				model: assistantMessageModel(this.turnModelUse),
				finishReason: event.finishReason,
				usage,
				cost: costFromUsage(usage, this.turnModelUse.model.pricing),
				responseId: event.responseId.length === 0 ? null : event.responseId,
				parts: assistantPartsFromAIContent(event.content),
			},
			this.options,
		)
		if (!assistant.ok) return this.fail(assistant.error)

		if (assistant.value.body.type !== 'assistant-message') throw new Error('Expected assistant-message event body after append.')
		this.registerPendingToolCalls(assistant.value as AgentRunEventWithBody<'assistant-message'>)
		const draftId = this.#draftIdByCallId.get(event.callId)
		if (draftId !== undefined) {
			await emit(this.options, {
				type: 'assistant-message-draft-updated',
				turnStartedEventId: this.turnStarted.id,
				draftId,
				delta: { type: 'model-output-ended' },
			})
		}
	}

	async onChunk(chunk: TextStreamPart<ToolSet>): Promise<void> {
		const draftId = this.#currentDraftId
		if (draftId === null) return

		switch (chunk.type) {
			case 'text-start':
				this.startPart(chunk.id)
				await this.emitModelDelta(draftId, { type: 'text-started', contentIndex: this.indexForPart(chunk.id) })
				return
			case 'text-delta':
				this.appendPartText(chunk.id, chunk.text)
				await this.emitModelDelta(draftId, { type: 'text-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text })
				return
			case 'text-end':
				await this.emitModelDelta(draftId, {
					type: 'text-ended',
					contentIndex: this.indexForPart(chunk.id),
					text: this.#textByPartId.get(chunk.id) ?? '',
				})
				return
			case 'reasoning-start':
				this.startPart(chunk.id)
				await this.emitModelDelta(draftId, { type: 'thinking-started', contentIndex: this.indexForPart(chunk.id) })
				return
			case 'reasoning-delta':
				this.appendPartText(chunk.id, chunk.text)
				await this.emitModelDelta(draftId, { type: 'thinking-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text })
				return
			case 'reasoning-end':
				await this.emitModelDelta(draftId, {
					type: 'thinking-ended',
					contentIndex: this.indexForPart(chunk.id),
					text: this.#textByPartId.get(chunk.id) ?? '',
				})
				return
			case 'tool-input-start':
				this.startPart(chunk.id)
				await this.emitModelDelta(draftId, {
					type: 'tool-call-arguments-started',
					contentIndex: this.indexForPart(chunk.id),
					toolCallId: chunk.id,
					toolName: chunk.toolName,
				})
				return
			case 'tool-input-delta':
				await this.emitModelDelta(draftId, {
					type: 'tool-call-arguments-delta',
					contentIndex: this.indexForPart(chunk.id),
					toolCallId: chunk.id,
					delta: chunk.delta,
				})
				return
			case 'tool-call':
				await this.emitModelDelta(draftId, {
					type: 'tool-call-arguments-ended',
					contentIndex: this.indexForPart(chunk.toolCallId),
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: chunk.input,
				})
				return
			default:
				return
		}
	}

	recordUnclosedModelFailure(_error: unknown, _signal: AbortSignal | undefined): Result<void, AgentRunRuntimeError> {
		return { ok: true, value: undefined }
	}

	private emitModelDelta(draftId: string, delta: AgentRunModelDelta) {
		return emit(this.options, {
			type: 'assistant-message-draft-updated',
			turnStartedEventId: this.turnStarted.id,
			draftId,
			delta,
		})
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

	private aiTool(coreTool: CoreAgentRunTool) {
		const exposed = providerTool(coreTool)
		return aiTool<unknown, AgentRunToolOutput, Record<string, unknown>>({
			description: exposed.description,
			inputSchema: jsonSchema<unknown>(exposed.parameters as never),
			execute: (input, execution) => this.executeTool(coreTool, input, execution),
			toModelOutput: ({ output }) => toAISDKToolOutput(output.output) as never,
		})
	}

	private async executeTool(
		coreTool: CoreAgentRunTool,
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

		try {
			const output = await coreTool.execute(validated.value, {
				agentRunId: this.state.agentRun.id,
				assistantMessageEventId: group.assistantMessageEventId,
				toolCallId: execution.toolCallId,
				signal: execution.abortSignal ?? this.options.signal ?? new AbortController().signal,
				onUpdate: (update) => {
					void emit(this.options, {
						type: 'tool-call-updated',
						turnStartedEventId: this.turnStarted.id,
						toolCallId: execution.toolCallId,
						update,
					})
				},
				recordProposal: (body) =>
					recordToolProposal(this.runtime, this.state.agentRun.id, group.assistantMessageEventId, execution.toolCallId, body),
			})
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
		} catch {
			const output = toolOutput('Tool execution failed.')
			return this.recordToolPart(group, {
				type: 'tool-error',
				toolCallId: execution.toolCallId,
				toolName: coreTool.name,
				providerExecuted: false,
				started: started.value,
				completed: runtimeRecordOrSame(this.runtime.values, started.value),
				reason: { type: 'tool-runtime-error' },
				error: output.output,
				truncation: output.truncation,
				metadata: null,
			})
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
		const event = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{
				type: 'tool-message',
				turnStartedEventId: group.turnStartedEventId,
				respondsToAssistantMessageEventId: group.assistantMessageEventId,
				source: { type: 'tool-execution' },
				parts,
			},
			this.options,
		)
		if (!event.ok) this.fail(event.error)
		for (const toolCallId of group.orderedToolCallIds) this.#pendingToolGroupByToolCallId.delete(toolCallId)
	}

	private fail(error: AgentRunRuntimeError): never {
		this.#error = error
		throw new Error(`Agent Run transcript persistence failed: ${error.type}`)
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
