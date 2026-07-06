import {
	isStepCount,
	jsonSchema,
	streamText,
	tool as aiTool,
	type ContentPart,
	type JSONValue,
	type LanguageModel,
	type LanguageModelCallEndEvent,
	type LanguageModelUsage,
	type ModelMessage,
	type TextStreamPart,
	type ToolExecutionOptions,
	type ToolSet,
} from 'ai'

import { buildAgentRunModelContext } from './context'
import type { AgentRunLiveEvent, AgentRunModelDelta } from './live-events'
import { providerTool, toolOutput, toolsForAgentRunPurpose, validateToolInput, type CoreAgentRunTool } from './tools'
import type { ModelAgentTurnThinking } from './types'
import { acceptAgentRunSandboxRelease, acceptDispatchRequest, exclusiveDeliverySchedulerClaim } from '../../commands/utils/dispatch'
import {
	type AgentRun,
	type AgentRunAssistantTranscriptPart,
	type AgentRunEvent,
	type AgentRunEventCursor,
	type AgentRunLanguageModelUsage,
	type AgentRunModelCost,
	type AgentRunToolOutput,
	type AgentRunToolResultOutput,
	type AgentRunToolTranscriptPart,
	type TurnErrorReason,
} from '../../domain/agent-run'
import type { Id, RuntimeRecord } from '../../domain/commons'
import type { Model, ModelThinkingLevel, ModelTokenPricing } from '../../domain/model'
import { modelProviderProtocolForSource, type ModelProvider } from '../../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ModelNotSelectableError,
	ModelThinkingLevelUnavailableError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreProviders } from '../../providers'
import { providerFailureReason } from '../../providers/model-provider-protocol/provider-failures'
import { validateModelThinkingLevelForUse } from '../../providers/model-provider-protocol/thinking'
import type { CoreServices, CoreStorage } from '../../services'
import { getRequired, listRecords, updateRecord, withTransaction } from '../../storage/helpers'
import { appendAgentRunEvent } from '../../utils/agent-run-events'
import { runtimeRecord, type CoreRuntimeValues } from '../../utils/runtime-values'
import type { Result } from '../../utils/types'

export type AgentRunRuntimeError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export interface RunModelAgentRunOptions {
	signal?: AbortSignal
	onEvent?(event: AgentRunLiveEvent): void | Promise<void>
}

export interface ModelAgentRunRuntime {
	services: CoreServices
	providers: CoreProviders
	values: CoreRuntimeValues
}

interface AgentRunLoopState {
	agentRun: AgentRun
	events: AgentRunEvent[]
	tools: CoreAgentRunTool[]
}

interface TurnReasonClaim {
	reason: Extract<AgentRunEvent['body'], { type: 'turn-started' }>['reason']
	contextThroughCursor: AgentRunEventCursor
}

const maxModelStepsPerTurn = 5

export async function runModelAgentRun(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	options: RunModelAgentRunOptions = {},
): Promise<Result<void, AgentRunRuntimeError>> {
	const state = await loadLoopState(runtime.services.storage, agentRunId)
	if (!state.ok) return state
	if (state.value.agentRun.completed !== null) return { ok: true, value: undefined }
	if (!agentRunReadyForModelTurn(state.value.agentRun)) return { ok: true, value: undefined }

	const claim = nextTurnClaim(state.value.events)
	if (claim === null) return { ok: true, value: undefined }

	const turn = await runTurn(runtime, state.value, claim, options)
	if (!turn.ok) return turn
	return turn.value.type === 'completed' ? completeAutonomousRunIfNeeded(runtime, state.value.agentRun) : { ok: true, value: undefined }
}

async function loadLoopState(storage: CoreStorage, agentRunId: Id): Promise<Result<AgentRunLoopState, AgentRunRuntimeError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'cursor', direction: 'asc' }],
	})
	if (!events.ok) return events

	return { ok: true, value: { agentRun: agentRun.value, events: events.value, tools: toolsForAgentRunPurpose(agentRun.value.purpose) } }
}

function agentRunReadyForModelTurn(agentRun: AgentRun): boolean {
	return (
		agentRun.blocked === null &&
		agentRun.sandbox.assignment !== null &&
		agentRun.sandbox.appliedRequirements.length === agentRun.desiredRuntimeRequirements.length &&
		agentRun.sandbox.appliedThroughCursor === (agentRun.runtimeRequirementOverrides.at(-1)?.eventCursor ?? null)
	)
}

function nextTurnClaim(events: AgentRunEvent[]): TurnReasonClaim | null {
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

type TurnResult = { type: 'completed' } | { type: 'failed' }

async function runTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnStarted = await appendAndEmit(runtime, state.agentRun.id, turnStartedBody(claim), options)
	return turnStarted.ok ? runStartedTurn(runtime, state, claim, turnStarted.value, options) : turnStarted
}

function turnStartedBody(claim: TurnReasonClaim): AgentRunEvent['body'] {
	return { type: 'turn-started', contextThroughCursor: claim.contextThroughCursor, reason: claim.reason }
}

async function runStartedTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	turnStarted: AgentRunEvent,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnModelUse = await loadTurnModelUse(runtime.services.storage, state.agentRun)
	if (!turnModelUse.ok) return handleTurnModelUseError(runtime, state.agentRun.id, turnStarted, turnModelUse.error, options)

	const resolution = await runtime.providers.modelProviderProtocols.resolveLanguageModel({
		mode: 'agent-run',
		model: turnModelUse.value.model,
		modelProvider: turnModelUse.value.modelProvider,
		thinking: turnModelUse.value.thinking,
	})
	if (!resolution.ok) return handleTurnModelUseError(runtime, state.agentRun.id, turnStarted, resolution.error, options)
	if (!('languageModel' in resolution.value)) {
		return recordTurnFailure(runtime, state.agentRun.id, turnStarted, resolution.value, options)
	}

	const modelContext = buildAgentRunModelContext(state.events, claim.contextThroughCursor)
	const aiTurn = await runAISDKTurn(runtime, state, turnStarted, turnModelUse.value, modelContext.messages, resolution.value, options)
	if (!aiTurn.ok) return aiTurn

	const ended = await appendAndEmit(
		runtime,
		state.agentRun.id,
		{ type: 'turn-ended', turnStartedCursor: turnStarted.cursor, outcome: aiTurn.value.turnOutcome },
		options,
	)
	if (!ended.ok) return ended

	return { ok: true, value: aiTurn.value.turnOutcome.type === 'completed' ? { type: 'completed' } : { type: 'failed' } }
}

async function handleTurnModelUseError(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	turnStarted: AgentRunEvent,
	error: AgentRunRuntimeError | ModelThinkingLevelUnavailableError | ModelNotSelectableError,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	if (error.type === 'model-thinking-level-unavailable' || error.type === 'model-not-selectable') {
		return recordTurnFailure(runtime, agentRunId, turnStarted, { type: 'runtime-error' }, options)
	}
	return { ok: false, error }
}

async function recordTurnFailure(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	turnStarted: AgentRunEvent,
	reason: TurnErrorReason,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const turnEnded = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'turn-ended', turnStartedCursor: turnStarted.cursor, outcome: { type: 'error', reason } },
		options,
	)
	return turnEnded.ok ? { ok: true, value: { type: 'failed' } } : turnEnded
}

type TurnModelUse = {
	model: Model
	modelProvider: ModelProvider
	thinking: ModelAgentTurnThinking
}

type TurnModelUseError = AgentRunRuntimeError | ModelThinkingLevelUnavailableError | ModelNotSelectableError

async function loadTurnModelUse(storage: CoreStorage, agentRun: AgentRun): Promise<Result<TurnModelUse, TurnModelUseError>> {
	const modelUse = agentRun.modelUseOverride?.modelUse ?? agentRun.profile.modelUse
	const model = await getRequired('model', storage, modelUse.modelId)
	return model.ok ? loadTurnModelUseModel(storage, modelUse.thinkingLevel, model.value) : model
}

async function loadTurnModelUseModel(
	storage: CoreStorage,
	thinkingLevel: ModelThinkingLevel,
	model: Model,
): Promise<Result<TurnModelUse, TurnModelUseError>> {
	if (isArchived(model)) return { ok: false, error: { type: 'model-not-selectable', modelId: model.id, reason: 'model-archived' } }

	const provider = await getRequired('model-provider', storage, model.providerId)
	return provider.ok ? turnModelUseForProvider(thinkingLevel, model, provider.value) : provider
}

function turnModelUseForProvider(
	thinkingLevel: ModelThinkingLevel,
	model: Model,
	modelProvider: ModelProvider,
): Result<TurnModelUse, ModelThinkingLevelUnavailableError | ModelNotSelectableError> {
	if (isArchived(modelProvider))
		return { ok: false, error: { type: 'model-not-selectable', modelId: model.id, reason: 'provider-archived' } }

	const thinking = resolveProviderTurnThinking(model, modelProvider, thinkingLevel)
	return thinking.ok ? { ok: true, value: { model, modelProvider, thinking: thinking.value } } : thinking
}

function resolveProviderTurnThinking(
	model: Model,
	modelProvider: ModelProvider,
	thinkingLevel: ModelThinkingLevel,
): Result<ModelAgentTurnThinking, ModelThinkingLevelUnavailableError> {
	const validation = validateModelThinkingLevelForUse(model, modelProviderProtocolForSource(modelProvider.source), thinkingLevel)
	return validation.ok ? { ok: true, value: { level: thinkingLevel } } : validation
}

function isArchived(record: { archivePeriods: Array<{ unarchived: object | null }> }): boolean {
	return record.archivePeriods.at(-1)?.unarchived === null
}

type AISDKTurnOutput = {
	turnOutcome: Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome']
}

async function runAISDKTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	turnStarted: AgentRunEvent,
	turnModelUse: TurnModelUse,
	messages: ModelMessage[],
	resolution: { languageModel: LanguageModel; providerOptions: Record<string, Record<string, JSONValue>> | undefined },
	options: RunModelAgentRunOptions,
): Promise<Result<AISDKTurnOutput, AgentRunRuntimeError>> {
	const recorder = new AISDKTurnRecorder(runtime, state, turnStarted, turnModelUse, options)
	try {
		const streamOptions = {
			model: resolution.languageModel,
			messages,
			tools: recorder.tools(),
			stopWhen: isStepCount(maxModelStepsPerTurn),
			maxOutputTokens: turnModelUse.model.capabilities.maxOutputTokens,
			maxRetries: 0,
			...(aiSdkReasoningForThinking(turnModelUse.thinking) === undefined
				? {}
				: { reasoning: aiSdkReasoningForThinking(turnModelUse.thinking) }),
			...(resolution.providerOptions === undefined ? {} : { providerOptions: resolution.providerOptions }),
			onLanguageModelCallStart: (
				event: Parameters<NonNullable<Parameters<typeof streamText<ToolSet>>[0]['onLanguageModelCallStart']>>[0],
			) => recorder.onLanguageModelCallStart(event.callId),
			onLanguageModelCallEnd: (event: LanguageModelCallEndEvent<ToolSet>) => recorder.onLanguageModelCallEnd(event),
			onChunk: ({ chunk }: { chunk: TextStreamPart<ToolSet> }) => recorder.onChunk(chunk),
			...(options.signal === undefined ? {} : { abortSignal: options.signal }),
		}
		const result = streamText<ToolSet>(streamOptions)

		for await (const part of result.stream) {
			if (part.type === 'error') throw part.error
		}
		const recorded = recorder.operationError()
		return recorded === null ? { ok: true, value: { turnOutcome: { type: 'completed' } } } : { ok: false, error: recorded }
	} catch (error) {
		const recorded = recorder.operationError()
		if (recorded !== null) return { ok: false, error: recorded }

		const failure = recorder.recordUnclosedModelFailure(error, options.signal)
		if (!failure.ok) return failure
		return {
			ok: true,
			value: { turnOutcome: turnFailureOutcome(error, options.signal) },
		}
	}
}

function aiSdkReasoningForThinking(thinking: ModelAgentTurnThinking): ModelThinkingLevel | undefined {
	return thinking?.level
}

type RecordedToolPart =
	| Extract<AgentRunToolTranscriptPart, { type: 'tool-result' }>
	| Extract<AgentRunToolTranscriptPart, { type: 'tool-error' }>

type PendingToolGroup = {
	assistantMessageCursor: AgentRunEventCursor
	turnStartedCursor: AgentRunEventCursor
	orderedToolCallIds: string[]
	partsByToolCallId: Map<string, RecordedToolPart>
}

class AISDKTurnRecorder {
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
			turnStartedCursor: this.turnStarted.cursor,
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
				turnStartedCursor: this.turnStarted.cursor,
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
				turnStartedCursor: this.turnStarted.cursor,
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
			turnStartedCursor: this.turnStarted.cursor,
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
			assistantMessageCursor: assistant.cursor,
			turnStartedCursor: this.turnStarted.cursor,
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
				assistantMessageCursor: group.assistantMessageCursor,
				toolCallId: execution.toolCallId,
				signal: execution.abortSignal ?? this.options.signal ?? new AbortController().signal,
				onUpdate: (update) => {
					void emit(this.options, {
						type: 'tool-call-updated',
						turnStartedCursor: this.turnStarted.cursor,
						toolCallId: execution.toolCallId,
						update,
					})
				},
				recordProposal: (body) =>
					recordToolProposal(this.runtime, this.state.agentRun.id, group.assistantMessageCursor, execution.toolCallId, body),
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
				turnStartedCursor: group.turnStartedCursor,
				respondsToAssistantMessageCursor: group.assistantMessageCursor,
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

function assistantMessageModel(turnModelUse: TurnModelUse): Extract<AgentRunEvent['body'], { type: 'assistant-message' }>['model'] {
	return {
		modelId: turnModelUse.model.id,
		thinkingLevel: turnModelUse.thinking?.level ?? 'none',
		modelProviderId: turnModelUse.modelProvider.id,
		providerProtocol: modelProviderProtocolForSource(turnModelUse.modelProvider.source),
		providerModelId: turnModelUse.model.providerModelId,
	}
}

function assistantPartsFromAIContent(content: ReadonlyArray<ContentPart<ToolSet>>): AgentRunAssistantTranscriptPart[] {
	return content.flatMap((part) => {
		switch (part.type) {
			case 'text':
				return [{ type: 'text', text: part.text, metadata: metadataFromProvider(part.providerMetadata) }]
			case 'reasoning':
				return [{ type: 'reasoning', text: part.text, metadata: metadataFromProvider(part.providerMetadata) }]
			case 'reasoning-file':
				return [
					{
						type: 'reasoning-file',
						data: { type: 'data', data: part.file.base64 },
						mediaType: part.file.mediaType,
						metadata: metadataFromProvider(part.providerMetadata),
					},
				]
			case 'file':
				return [
					{
						type: 'file',
						data: { type: 'data', data: part.file.base64 },
						mediaType: part.file.mediaType,
						filename: null,
						metadata: metadataFromProvider(part.providerMetadata),
					},
				]
			case 'source':
				return [sourcePartFromAI(part)]
			case 'custom':
				return [{ type: 'custom', kind: part.kind, metadata: metadataFromProvider(part.providerMetadata) }]
			case 'tool-call':
				return [
					{
						type: 'tool-call',
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						input: part.input,
						providerExecuted: part.providerExecuted === true,
						metadata: metadataFromProvider(part.providerMetadata),
					},
				]
			case 'tool-result':
				return part.providerExecuted === true
					? [
							{
								type: 'tool-result',
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								providerExecuted: true,
								output: normalizeToolResultOutput(part.output),
								metadata: metadataFromProvider(part.providerMetadata),
							},
						]
					: []
			case 'tool-error':
				return part.providerExecuted === true
					? [
							{
								type: 'tool-error',
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								providerExecuted: true,
								error: part.error,
								metadata: metadataFromProvider(part.providerMetadata),
							},
						]
					: []
			case 'tool-approval-request':
				return [
					{
						type: 'tool-approval-request',
						approvalId: part.approvalId,
						toolCallId: part.toolCall.toolCallId,
						toolName: part.toolCall.toolName,
						providerExecuted: part.toolCall.providerExecuted === true,
						metadata: null,
					},
				]
			case 'tool-approval-response':
				return []
			default:
				throw new Error(`Unexpected AI SDK content part: ${String(part satisfies never)}`)
		}
	})
}

function sourcePartFromAI(part: Extract<ContentPart<ToolSet>, { type: 'source' }>): AgentRunAssistantTranscriptPart {
	const source = recordFromUnknown(part)
	return {
		type: 'source',
		sourceType: stringFromRecord(source, 'sourceType') ?? 'source',
		id: stringFromRecord(source, 'id') ?? 'source',
		title: stringFromRecord(source, 'title'),
		url: stringFromRecord(source, 'url'),
		mediaType: stringFromRecord(source, 'mediaType'),
		metadata: metadataFromProvider(source.providerMetadata),
	}
}

function metadataFromProvider(providerMetadata: unknown): Record<string, unknown> | null {
	return isRecord(providerMetadata) ? providerMetadata : null
}

function normalizeToolResultOutput(output: unknown): AgentRunToolResultOutput {
	if (typeof output === 'string') return { type: 'text', value: output }
	if (isRecord(output) && output.type === 'text' && typeof output.value === 'string') return { type: 'text', value: output.value }
	if (isRecord(output) && output.type === 'error-text' && typeof output.value === 'string')
		return { type: 'error-text', value: output.value }
	if (isRecord(output) && output.type === 'execution-denied') {
		return { type: 'execution-denied', reason: typeof output.reason === 'string' ? output.reason : null }
	}
	if (isRecord(output) && output.type === 'json') return { type: 'json', value: output.value }
	return { type: 'json', value: output }
}

function toAISDKToolOutput(output: AgentRunToolResultOutput): unknown {
	return output.type === 'execution-denied' && output.reason === null ? { type: output.type } : output
}

function usageFromAIUsage(usage: LanguageModelUsage): AgentRunLanguageModelUsage {
	return {
		inputTokens: usage.inputTokens ?? null,
		inputTokenDetails: {
			noCacheTokens: usage.inputTokenDetails.noCacheTokens ?? null,
			cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
			cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
		},
		outputTokens: usage.outputTokens ?? null,
		outputTokenDetails: {
			textTokens: usage.outputTokenDetails.textTokens ?? null,
			reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
		},
	}
}

function costFromUsage(usage: AgentRunLanguageModelUsage, pricing: ModelTokenPricing | null): AgentRunModelCost | null {
	if (pricing === null) return null
	if (usage.inputTokenDetails.noCacheTokens === null || usage.outputTokens === null) return null
	const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0
	const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0
	return {
		unit: 'micro-usd',
		input: tokenCost(usage.inputTokenDetails.noCacheTokens, pricing.input),
		output: tokenCost(usage.outputTokens, pricing.output),
		cacheRead: tokenCost(cacheReadTokens, pricing.cacheRead),
		cacheWrite: tokenCost(cacheWriteTokens, pricing.cacheWrite),
	}
}

function tokenCost(tokens: number, priceMicroUsdPerMillion: number): number {
	if (tokens === 0 || priceMicroUsdPerMillion === 0) return 0
	return Math.round((tokens * priceMicroUsdPerMillion) / 1_000_000)
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

async function recordToolProposal(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	assistantMessageCursor: AgentRunEventCursor,
	toolCallId: string,
	body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown },
): Promise<AgentRunToolOutput> {
	const eventBody =
		body.type === 'proposed-plan-output'
			? { type: body.type, assistantMessageCursor, toolCallId, output: body.output as never }
			: { type: body.type, assistantMessageCursor, toolCallId, output: body.output as never }
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, eventBody)
	return event.ok
		? toolOutput(`${body.type} recorded for human review as event ${event.value.id}.`)
		: toolOutput(`Failed to record proposal: ${event.error.type}.`)
}

function turnFailureOutcome(
	error: unknown,
	signal: AbortSignal | undefined,
): Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome'] {
	if (signal?.aborted === true) return { type: 'error', reason: { type: 'abort-signal' } }
	return { type: 'error', reason: providerFailureReason(error) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {}
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
	const value = record[key]
	return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function completeAutonomousRunIfNeeded(
	runtime: ModelAgentRunRuntime,
	agentRun: AgentRun,
): Promise<Result<void, AgentRunRuntimeError>> | Result<void, never> {
	return agentRun.purpose.type === 'execution' || agentRun.purpose.type === 'revision-execution'
		? completeAgentRun(runtime, agentRun)
		: { ok: true, value: undefined }
}

async function completeAgentRun(runtime: ModelAgentRunRuntime, agentRun: AgentRun): Promise<Result<void, AgentRunRuntimeError>> {
	const completed = runtimeRecord(runtime.values)
	if (!completed.ok) return completed
	const updated = await withTransaction<string[], AgentRunRuntimeError>(runtime.services, async (storage) => {
		const stored = await updateRecord('agent-run', storage, agentRun.id, { completed: completed.value })
		if (!stored.ok) return stored

		const schedulerMarker =
			agentRun.purpose.type === 'execution'
				? await acceptDispatchRequest(runtime.services.dispatcher, {
						type: 'delivery-work-scheduler',
						deliveryId: agentRun.purpose.deliveryId,
						coordinationClaims: [exclusiveDeliverySchedulerClaim(agentRun.purpose.deliveryId)],
						reason: { type: 'delivery-work-requested' },
					})
				: null
		if (schedulerMarker !== null && !schedulerMarker.ok) return schedulerMarker

		const releaseMarker = await acceptAgentRunSandboxRelease(runtime.services.dispatcher, agentRun.id)
		if (!releaseMarker.ok) return releaseMarker

		return { ok: true, value: [...(schedulerMarker === null ? [] : [schedulerMarker.value]), releaseMarker.value] }
	})
	if (!updated.ok) return updated

	for (const marker of updated.value) runtime.services.dispatcher.ready(marker)
	return { ok: true, value: undefined }
}

async function appendAndEmit(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	body: AgentRunEvent['body'],
	options: RunModelAgentRunOptions,
): Promise<Result<AgentRunEvent, AgentRunRuntimeError>> {
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, body)
	if (event.ok) await emit(options, { type: 'persisted', event: event.value })
	return event
}

async function emit(options: RunModelAgentRunOptions, event: AgentRunLiveEvent): Promise<void> {
	try {
		await options.onEvent?.(event)
	} catch {
		// Streaming is best-effort; storage remains source of truth.
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedSelectableModel } = await import('../../utils/test-helpers')

	describe('runModelAgentRun', () => {
		it('no-ops completed Agent Runs without processing queued input', async () => {
			const services = planningFixture()
			services.tx.agentRuns.records.get('agent-run-1')!.completed = { at: '2026-06-10T12:05:00.000Z' }
			const initialEventCount = services.tx.agentRunEvents.records.size
			const runtime = modelLoopRuntime(services)

			const result = await runModelAgentRun(runtime, 'agent-run-1')

			expect(result).toEqual({ ok: true, value: undefined })
			expect(services.tx.agentRunEvents.records.size).toBe(initialEventCount)
		})

		it('blocks after operator interrupts until new input', async () => {
			const services = planningFixture()
			services.tx.agentRunEvents.records.set('interrupt', {
				id: 'interrupt',
				agentRunId: 'agent-run-1',
				cursor: cursor(3),
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'interrupt-requested',
					source: { type: 'operator', authorized: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' } },
					reason: null,
				},
			})
			const runtime = modelLoopRuntime(services)

			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toEqual({ ok: true, value: undefined })
			expect([...services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'turn-started')).toBe(false)

			services.tx.agentRunEvents.records.set('input-2', {
				id: 'input-2',
				agentRunId: 'agent-run-1',
				cursor: cursor(4),
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: { type: 'input-message', source: { type: 'runtime' }, parts: [{ type: 'text', text: 'continue', metadata: null }] },
			})
			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toMatchObject({ ok: true })
			expect([...services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'turn-started')).toBe(true)
		})
	})

	function planningFixture() {
		const services = createTestCoreServices()
		seedSelectableModel(services.tx, 'model-1')
		services.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			profile: {
				agentRunProfileId: 'agent-run-profile-1',
				name: 'Planning',
				modelUse: { modelId: 'model-1', thinkingLevel: 'none' },
				runtimeRequirements: [],
			},
			modelUseOverride: null,
			sourceRuntimeRequirements: [],
			runtimeRequirementOverrides: [],
			desiredRuntimeRequirements: [],
			blocked: null,
			sandbox: {
				assignment: { ref: 'sandbox-ref', assigned: { at: '2026-06-10T12:00:00.000Z' } },
				appliedRequirements: [],
				appliedThroughCursor: null,
				released: null,
			},
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		seedInitialEvents(services)
		return services
	}

	function seedInitialEvents(services: ReturnType<typeof createTestCoreServices>) {
		services.tx.agentRunEvents.records.set('input-1', {
			id: 'input-1',
			agentRunId: 'agent-run-1',
			cursor: cursor(1),
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: { type: 'input-message', source: { type: 'runtime' }, parts: [{ type: 'text', text: 'start', metadata: null }] },
		})
	}

	function modelLoopRuntime(services: ReturnType<typeof createTestCoreServices>): ModelAgentRunRuntime {
		return { services, providers: { ...createTestProviders() }, values: services.values }
	}

	function createTestProviders(): CoreProviders {
		return {
			sourceControl: {
				preflightRepository: () => Promise.reject(new Error('unused')),
				createArtifactBranch: () => Promise.reject(new Error('unused')),
				createReviewSurface: () => Promise.reject(new Error('unused')),
			},
			modelProviderProtocols: {
				preflightModel: () => Promise.reject(new Error('unused')),
				resolveLanguageModel: () => Promise.resolve({ ok: true, value: { type: 'runtime-error' } }),
			},
		}
	}

	function cursor(index: number): string {
		return `01J000000000000000000${index.toString().padStart(5, '0')}`
	}
}
