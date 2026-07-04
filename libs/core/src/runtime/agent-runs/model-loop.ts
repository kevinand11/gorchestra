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
import type { AgentRunLiveEvent } from './live-events'
import { providerTool, toolOutput, toolsForAgentRunPurpose, validateToolInput, type CoreAgentRunTool } from './tools'
import type { ModelAgentTurnThinking } from './types'
import {
	type AgentRun,
	type AgentRunEvent,
	type AgentRunEventCursor,
	type AgentRunModelContent,
	type AgentRunModelCost,
	type AgentRunModelMessage,
	type AgentRunModelMessageOutcome,
	type AgentRunToolCallOutcome,
	type AgentRunToolOutput,
} from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { Model, ModelThinkingLevel, ModelTokenPricing } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ModelNotSelectableError,
	ModelThinkingLevelUnavailableError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreProviders } from '../../providers'
import { providerFailureReason, safeProviderErrorSummary } from '../../providers/model-provider-protocol/provider-failures'
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
	contextThroughCursor: AgentRunEventCursor | null
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

function nextTurnClaim(events: AgentRunEvent[]): TurnReasonClaim | null {
	return turnClaimForReason(nextInputTurnReason(events), events.at(-1)?.cursor ?? null)
}

function turnClaimForReason(
	reason: TurnReasonClaim['reason'] | null,
	contextThroughCursor: AgentRunEventCursor | null,
): TurnReasonClaim | null {
	return reason === null ? null : { reason, contextThroughCursor }
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
		return recordSyntheticModelOutcome(runtime, state.agentRun.id, turnStarted, resolution.value, options)
	}

	const modelContext = buildAgentRunModelContext(state.events, claim.contextThroughCursor)
	const aiTurn = await runAISDKTurn(
		runtime,
		state,
		turnStarted,
		turnModelUse.value.model,
		modelContext.messages,
		turnModelUse.value.thinking,
		resolution.value,
		options,
	)
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
	if (error.type === 'model-thinking-level-unavailable') {
		return recordSyntheticModelOutcome(runtime, agentRunId, turnStarted, staleThinkingOutcome(error), options)
	}
	if (error.type === 'model-not-selectable') {
		return recordSyntheticModelOutcome(runtime, agentRunId, turnStarted, staleModelOutcome(error), options)
	}
	return { ok: false, error }
}

async function recordSyntheticModelOutcome(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	turnStarted: AgentRunEvent,
	outcome: AgentRunModelMessageOutcome,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const modelStarted = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'model-message-started', turnStartedCursor: turnStarted.cursor, aiSdkCallId: null },
		options,
	)
	if (!modelStarted.ok) return modelStarted

	const modelEnded = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'model-message-ended', modelMessageStartedCursor: modelStarted.value.cursor, outcome },
		options,
	)
	if (!modelEnded.ok) return modelEnded

	const turnEnded = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'turn-ended', turnStartedCursor: turnStarted.cursor, outcome: { type: 'completed' } },
		options,
	)
	return turnEnded.ok ? { ok: true, value: { type: 'completed' } } : turnEnded
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
	const validation = validateModelThinkingLevelForUse(model, modelProvider.protocol, thinkingLevel)
	return validation.ok ? { ok: true, value: { level: thinkingLevel } } : validation
}

function staleThinkingOutcome(error: ModelThinkingLevelUnavailableError): AgentRunModelMessageOutcome {
	return {
		type: 'error',
		reason: { type: 'runtime-error' },
		message: null,
		summary: `Selected thinking level ${error.thinkingLevel} is unavailable for Model ${error.modelId}.`,
	}
}

function staleModelOutcome(error: ModelNotSelectableError): AgentRunModelMessageOutcome {
	return {
		type: 'error',
		reason: { type: 'runtime-error' },
		message: null,
		summary: `Selected Model ${error.modelId} is unavailable: ${error.reason}.`,
	}
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
	model: Model,
	messages: ModelMessage[],
	thinking: ModelAgentTurnThinking,
	resolution: { languageModel: LanguageModel; providerOptions: Record<string, Record<string, JSONValue>> | undefined },
	options: RunModelAgentRunOptions,
): Promise<Result<AISDKTurnOutput, AgentRunRuntimeError>> {
	const recorder = new AISDKTurnRecorder(runtime, state, turnStarted, model, options)
	try {
		const streamOptions = {
			model: resolution.languageModel,
			messages,
			tools: recorder.tools(),
			stopWhen: isStepCount(maxModelStepsPerTurn),
			maxOutputTokens: model.capabilities.maxOutputTokens,
			maxRetries: 0,
			...(aiSdkReasoningForThinking(thinking) === undefined ? {} : { reasoning: aiSdkReasoningForThinking(thinking) }),
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

		const failure = await recorder.recordUnclosedModelFailure(error, options.signal)
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

class AISDKTurnRecorder {
	readonly #modelStartedByCallId = new Map<string, AgentRunEvent>()
	readonly #modelEndedCallIds = new Set<string>()
	readonly #contentIndexByPartId = new Map<string, number>()
	readonly #textByPartId = new Map<string, string>()
	readonly #toolNameByPartId = new Map<string, string>()
	#currentCallId: string | null = null
	#latestModelEndedCursor: AgentRunEventCursor | null = null
	#error: AgentRunRuntimeError | null = null
	#nextContentIndex = 0

	constructor(
		private readonly runtime: ModelAgentRunRuntime,
		private readonly state: AgentRunLoopState,
		private readonly turnStarted: AgentRunEvent,
		private readonly model: Model,
		private readonly options: RunModelAgentRunOptions,
	) {}

	operationError(): AgentRunRuntimeError | null {
		return this.#error
	}

	tools(): ToolSet {
		return Object.fromEntries(this.state.tools.map((coreTool) => [coreTool.name, this.aiTool(coreTool)]))
	}

	async onLanguageModelCallStart(callId: string): Promise<void> {
		const event = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{ type: 'model-message-started', turnStartedCursor: this.turnStarted.cursor, aiSdkCallId: callId },
			this.options,
		)
		if (!event.ok) return this.fail(event.error)

		this.#currentCallId = callId
		this.#modelStartedByCallId.set(callId, event.value)
		this.#contentIndexByPartId.clear()
		this.#textByPartId.clear()
		this.#toolNameByPartId.clear()
		this.#nextContentIndex = 0
		await emit(this.options, {
			type: 'model-message-updated',
			modelMessageStartedCursor: event.value.cursor,
			delta: { type: 'model-output-started' },
		})
	}

	async onLanguageModelCallEnd(event: LanguageModelCallEndEvent<ToolSet>): Promise<void> {
		const started = this.#modelStartedByCallId.get(event.callId)
		if (started === undefined) return

		const ended = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{
				type: 'model-message-ended',
				modelMessageStartedCursor: started.cursor,
				outcome: outcomeFromLanguageModelCall(event, this.model),
			},
			this.options,
		)
		if (!ended.ok) return this.fail(ended.error)

		this.#latestModelEndedCursor = ended.value.cursor
		this.#modelEndedCallIds.add(event.callId)
		await emit(this.options, {
			type: 'model-message-updated',
			modelMessageStartedCursor: started.cursor,
			delta: { type: 'model-output-ended' },
		})
	}

	async onChunk(chunk: TextStreamPart<ToolSet>): Promise<void> {
		const started = this.currentModelStarted()
		if (started === null) return

		switch (chunk.type) {
			case 'text-start':
				this.startPart(chunk.id)
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: { type: 'text-started', contentIndex: this.indexForPart(chunk.id) },
				})
				return
			case 'text-delta':
				this.appendPartText(chunk.id, chunk.text)
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: { type: 'text-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text },
				})
				return
			case 'text-end':
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: { type: 'text-ended', contentIndex: this.indexForPart(chunk.id), text: this.#textByPartId.get(chunk.id) ?? '' },
				})
				return
			case 'reasoning-start':
				this.startPart(chunk.id)
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: { type: 'thinking-started', contentIndex: this.indexForPart(chunk.id) },
				})
				return
			case 'reasoning-delta':
				this.appendPartText(chunk.id, chunk.text)
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: { type: 'thinking-delta', contentIndex: this.indexForPart(chunk.id), delta: chunk.text },
				})
				return
			case 'reasoning-end':
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: {
						type: 'thinking-ended',
						contentIndex: this.indexForPart(chunk.id),
						text: this.#textByPartId.get(chunk.id) ?? '',
					},
				})
				return
			case 'tool-input-start':
				this.#toolNameByPartId.set(chunk.id, chunk.toolName)
				this.startPart(chunk.id)
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: {
						type: 'tool-call-arguments-started',
						contentIndex: this.indexForPart(chunk.id),
						toolCallId: chunk.id,
						toolName: chunk.toolName,
					},
				})
				return
			case 'tool-input-delta':
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: {
						type: 'tool-call-arguments-delta',
						contentIndex: this.indexForPart(chunk.id),
						toolCallId: chunk.id,
						delta: chunk.delta,
					},
				})
				return
			case 'tool-call':
				await emit(this.options, {
					type: 'model-message-updated',
					modelMessageStartedCursor: started.cursor,
					delta: {
						type: 'tool-call-arguments-ended',
						contentIndex: this.indexForPart(chunk.toolCallId),
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						input: chunk.input,
					},
				})
				return
			default:
				return
		}
	}

	async recordUnclosedModelFailure(error: unknown, signal: AbortSignal | undefined): Promise<Result<void, AgentRunRuntimeError>> {
		const started = this.currentModelStarted()
		if (started === null || (this.#currentCallId !== null && this.#modelEndedCallIds.has(this.#currentCallId))) {
			return { ok: true, value: undefined }
		}

		const ended = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{
				type: 'model-message-ended',
				modelMessageStartedCursor: started.cursor,
				outcome: modelFailureOutcome(error, signal),
			},
			this.options,
		)
		return ended.ok ? { ok: true, value: undefined } : ended
	}

	private aiTool(coreTool: CoreAgentRunTool) {
		const exposed = providerTool(coreTool)
		return aiTool<unknown, AgentRunToolOutput, Record<string, unknown>>({
			description: exposed.description,
			inputSchema: jsonSchema<unknown>(exposed.parameters as never),
			execute: (input, execution) => this.executeTool(coreTool, input, execution),
			toModelOutput: ({ output }) => ({ type: 'text', value: toolOutputText(output) }),
		})
	}

	private async executeTool(
		coreTool: CoreAgentRunTool,
		input: unknown,
		execution: ToolExecutionOptions<Record<string, unknown>>,
	): Promise<AgentRunToolOutput> {
		const modelMessageCursor = this.#latestModelEndedCursor
		if (modelMessageCursor === null) return toolOutput('Tool call could not be recorded because model message context is missing.')

		const started = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{ type: 'tool-call-started', modelMessageCursor, toolCallId: execution.toolCallId, toolName: coreTool.name, input },
			this.options,
		)
		if (!started.ok) return this.failTool(started.error)

		const validated = validateToolInput(coreTool, input)
		if (!validated.ok) return this.endTool(started.value, invalidToolInputOutcome())

		try {
			const output = await coreTool.execute(validated.value, {
				agentRunId: this.state.agentRun.id,
				toolCallStartedCursor: started.value.cursor,
				signal: execution.abortSignal ?? this.options.signal ?? new AbortController().signal,
				onUpdate: (update) => {
					void emit(this.options, { type: 'tool-call-updated', toolCallStartedCursor: started.value.cursor, update })
				},
				recordProposal: (body) => recordToolProposal(this.runtime, this.state.agentRun.id, started.value.cursor, body),
			})
			return this.endTool(started.value, { type: 'success', output })
		} catch {
			return this.endTool(started.value, {
				type: 'error',
				reason: { type: 'tool-runtime-error' },
				output: toolOutput('Tool execution failed.'),
			})
		}
	}

	private async endTool(started: AgentRunEvent, outcome: AgentRunToolCallOutcome): Promise<AgentRunToolOutput> {
		const ended = await appendAndEmit(
			this.runtime,
			this.state.agentRun.id,
			{ type: 'tool-call-ended', toolCallStartedCursor: started.cursor, outcome },
			this.options,
		)
		if (!ended.ok) return this.failTool(ended.error)

		return outcome.output ?? toolOutput(`Tool ${outcome.type}.`)
	}

	private fail(error: AgentRunRuntimeError): never {
		this.#error = error
		throw new Error(`Agent Run transcript persistence failed: ${error.type}`)
	}

	private failTool(error: AgentRunRuntimeError): AgentRunToolOutput {
		this.#error = error
		throw new Error(`Agent Run tool transcript persistence failed: ${error.type}`)
	}

	private currentModelStarted(): AgentRunEvent | null {
		return this.#currentCallId === null ? null : (this.#modelStartedByCallId.get(this.#currentCallId) ?? null)
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

function outcomeFromLanguageModelCall(event: LanguageModelCallEndEvent<ToolSet>, model: Model): AgentRunModelMessageOutcome {
	const message = modelMessageFromAIContent(event.content, event.usage, event.responseId, model.pricing)
	switch (event.finishReason) {
		case 'stop':
		case 'other':
			return message.content.some((content) => content.type === 'tool-call')
				? { type: 'tool-calls', message }
				: { type: 'stop', message }
		case 'tool-calls':
			return { type: 'tool-calls', message }
		case 'length':
			return { type: 'length', message, summary: null }
		case 'content-filter':
			return {
				type: 'error',
				reason: { type: 'provider-content-filtered' },
				message: modelMessageOrNull(message),
				summary: 'Provider content filter blocked generation.',
			}
		case 'error':
			return {
				type: 'error',
				reason: { type: 'provider-generation-failed' },
				message: modelMessageOrNull(message),
				summary: 'Provider generation failed.',
			}
		default:
			throw new Error(`Unexpected AI SDK finish reason: ${String(event.finishReason satisfies never)}`)
	}
}

function modelFailureOutcome(error: unknown, signal: AbortSignal | undefined): AgentRunModelMessageOutcome {
	if (signal?.aborted === true) return { type: 'aborted', reason: { type: 'abort-signal' }, message: null, summary: null }
	const reason = providerFailureReason(error)
	return { type: 'error', reason, message: null, summary: safeProviderErrorSummary(reason) }
}

function turnFailureOutcome(
	error: unknown,
	signal: AbortSignal | undefined,
): Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome'] {
	if (signal?.aborted === true) return { type: 'aborted', reason: { type: 'abort-signal' }, summary: null }
	const reason = providerFailureReason(error)
	return { type: 'error', reason, summary: safeProviderErrorSummary(reason) }
}

function modelMessageFromAIContent(
	content: ReadonlyArray<ContentPart<ToolSet>>,
	usage: LanguageModelUsage,
	providerResponseRef: string,
	pricing: ModelTokenPricing | null,
): AgentRunModelMessage {
	return {
		content: content.flatMap(coreModelContent),
		usage: usageFromAIUsage(usage, pricing),
		providerResponseRef: providerResponseRef.length === 0 ? null : providerResponseRef,
	}
}

function coreModelContent(content: ContentPart<ToolSet>): AgentRunModelContent[] {
	switch (content.type) {
		case 'text':
			return [{ type: 'text', text: content.text }]
		case 'reasoning':
			return [{ type: 'thinking', text: content.text, providerReplay: null }]
		case 'tool-call':
			return [{ type: 'tool-call', toolCallId: content.toolCallId, toolName: content.toolName, input: content.input }]
		case 'custom':
		case 'source':
		case 'file':
		case 'reasoning-file':
		case 'tool-result':
		case 'tool-error':
		case 'tool-approval-request':
		case 'tool-approval-response':
			return []
		default:
			throw new Error(`Unexpected AI SDK content part: ${String(content satisfies never)}`)
	}
}

function modelMessageOrNull(message: AgentRunModelMessage): AgentRunModelMessage | null {
	return message.content.length === 0 && message.usage === null && message.providerResponseRef === null ? null : message
}

function usageFromAIUsage(usage: LanguageModelUsage, pricing: ModelTokenPricing | null): AgentRunModelMessage['usage'] {
	const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0
	const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0
	const inputTokens = usage.inputTokenDetails.noCacheTokens ?? Math.max((usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens, 0)
	const outputTokens = usage.outputTokens ?? 0
	const totalTokens = usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
	const tokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }
	return { ...tokenUsage, cost: pricing === null ? null : costFromUsage(tokenUsage, pricing) }
}

function costFromUsage(
	usage: Pick<NonNullable<AgentRunModelMessage['usage']>, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
	pricing: ModelTokenPricing,
): AgentRunModelCost {
	const input = tokenCost(usage.inputTokens, pricing.input)
	const output = tokenCost(usage.outputTokens, pricing.output)
	const cacheRead = tokenCost(usage.cacheReadTokens, pricing.cacheRead)
	const cacheWrite = tokenCost(usage.cacheWriteTokens, pricing.cacheWrite)
	return { unit: 'micro-usd', input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite }
}

function tokenCost(tokens: number, priceMicroUsdPerMillion: number): number {
	if (tokens === 0 || priceMicroUsdPerMillion === 0) return 0
	return Math.round((tokens * priceMicroUsdPerMillion) / 1_000_000)
}

function invalidToolInputOutcome(): AgentRunToolCallOutcome {
	return { type: 'error', reason: { type: 'invalid-input' }, output: toolOutput('Tool call input failed validation.') }
}

async function recordToolProposal(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	toolCallStartedCursor: AgentRunEventCursor,
	body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown },
): Promise<AgentRunToolOutput> {
	const eventBody =
		body.type === 'proposed-plan-output'
			? { type: body.type, toolCallStartedCursor, output: body.output as never }
			: { type: body.type, toolCallStartedCursor, output: body.output as never }
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, eventBody)
	return event.ok
		? toolOutput(`${body.type} recorded for human review as event ${event.value.id}.`)
		: toolOutput(`Failed to record proposal: ${event.error.type}.`)
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
	const updated = await withTransaction(runtime.services, (storage) =>
		updateRecord('agent-run', storage, agentRun.id, { completed: completed.value }),
	)
	return updated.ok ? { ok: true, value: undefined } : updated
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

function toolOutputText(output: AgentRunToolOutput): string {
	return output.content.map((part) => part.text).join('\n')
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
				body: { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'continue' }] },
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
			},
			modelUseOverride: null,
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
			body: { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'start' }] },
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
				resolveLanguageModel: () =>
					Promise.resolve({
						ok: true,
						value: {
							type: 'error',
							reason: { type: 'runtime-error' },
							message: null,
							summary: 'Synthetic test provider.',
						},
					}),
			},
		}
	}

	function cursor(index: number): string {
		return `01J000000000000000000${index.toString().padStart(5, '0')}`
	}
}
