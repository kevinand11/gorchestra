import { buildAgentRunModelContext } from './context'
import type { AgentRunLiveEvent } from './live-events'
import { providerTool, toolOutput, toolsForAgentRunPurpose, validateToolInput, type CoreAgentRunTool } from './tools'
import type { ModelAgentTurnThinking } from './types'
import type { AgentRun, AgentRunEvent, AgentRunModelMessageOutcome, AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { Model, ModelThinkingLevel } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreProviders } from '../../providers'
import type { CoreServices, CoreStorage } from '../../services'
import { getRequired, listRecords, updateRecord, withTransaction } from '../../storage/helpers'
import { appendAgentRunEvent } from '../../utils/agent-run-events'
import type { CoreRuntimeValues } from '../../utils/runtime-values'
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
	contextThroughSequence: number
}

const maxTurnsPerRun = 5

export function runModelAgentRun(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	options: RunModelAgentRunOptions = {},
): Promise<Result<void, AgentRunRuntimeError>> {
	return runModelAgentRunStep(runtime, agentRunId, options, null, 0)
}

async function runModelAgentRunStep(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	options: RunModelAgentRunOptions,
	followUpReason: TurnReasonClaim['reason'] | null,
	turn: number,
): Promise<Result<void, AgentRunRuntimeError>> {
	if (turn >= maxTurnsPerRun) return invariant(`Agent Run ${agentRunId} exceeded ${maxTurnsPerRun} model turns.`)

	const state = await loadLoopState(runtime.services.storage, agentRunId)
	if (!state.ok) return state

	const claim = nextTurnClaim(state.value.events, followUpReason)
	return claim === null ? { ok: true, value: undefined } : runClaimedTurn(runtime, state.value, claim, options, turn)
}

async function runClaimedTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	options: RunModelAgentRunOptions,
	turn: number,
): Promise<Result<void, AgentRunRuntimeError>> {
	const result = await runTurn(runtime, state, claim, options)
	if (!result.ok) return result
	return result.value.type === 'complete'
		? { ok: true, value: undefined }
		: runModelAgentRunStep(runtime, state.agentRun.id, options, result.value.nextReason, turn + 1)
}

async function loadLoopState(storage: CoreStorage, agentRunId: Id): Promise<Result<AgentRunLoopState, AgentRunRuntimeError>> {
	const agentRun = await getRequired('agent-run', storage, agentRunId)
	if (!agentRun.ok) return agentRun

	const events = await listRecords('agent-run-event', storage, {
		where: (filter, fields) => filter.eq(fields.agentRunId, agentRunId),
		orderBy: [{ field: 'sequence', direction: 'asc' }],
	})
	if (!events.ok) return events

	return { ok: true, value: { agentRun: agentRun.value, events: events.value, tools: toolsForAgentRunPurpose(agentRun.value.purpose) } }
}

function latestModelSelection(
	events: AgentRunEvent[],
	contextThroughSequence: number,
): Result<Extract<AgentRunEvent['body'], { type: 'agent-run-model-selected' }>, InvariantViolationError> {
	const selection = [...events]
		.filter((event) => event.sequence <= contextThroughSequence)
		.reverse()
		.find((event) => event.body.type === 'agent-run-model-selected')?.body
	return selection?.type === 'agent-run-model-selected'
		? { ok: true, value: selection }
		: invariant('Model Agent Run has no selected Model event before the turn context boundary.')
}

function nextTurnClaim(events: AgentRunEvent[], followUpReason: TurnReasonClaim['reason'] | null): TurnReasonClaim | null {
	return turnClaimForReason(nextTurnReason(events, followUpReason), events.at(-1)?.sequence ?? 0)
}

function nextTurnReason(events: AgentRunEvent[], followUpReason: TurnReasonClaim['reason'] | null): TurnReasonClaim['reason'] | null {
	return followUpReason === null ? nextInputTurnReason(events) : followUpReason
}

function turnClaimForReason(reason: TurnReasonClaim['reason'] | null, contextThroughSequence: number): TurnReasonClaim | null {
	return reason === null ? null : { reason, contextThroughSequence }
}

function nextInputTurnReason(events: AgentRunEvent[]): TurnReasonClaim['reason'] | null {
	if (hasBlockingOperatorInterrupt(events)) return null

	const inputEventIds = unprocessedInputEventIds(events)
	return inputEventIds.length === 0 ? null : { type: 'input', inputEventIds }
}

function hasBlockingOperatorInterrupt(events: AgentRunEvent[]): boolean {
	const latestInput = latestSequence(events, (event) => event.body.type === 'input-message')
	const latestOperatorInterrupt = latestSequence(
		events,
		(event) => event.body.type === 'interrupt-requested' && event.body.source.type === 'operator',
	)
	return latestOperatorInterrupt > latestInput
}

function unprocessedInputEventIds(events: AgentRunEvent[]): Id[] {
	const latestTurnStarted = latestSequence(events, (event) => event.body.type === 'turn-started')
	return events.filter((event) => event.sequence > latestTurnStarted && event.body.type === 'input-message').map((event) => event.id)
}

function latestSequence(events: AgentRunEvent[], predicate: (event: AgentRunEvent) => boolean): number {
	return events.filter(predicate).at(-1)?.sequence ?? 0
}

type TurnResult = { type: 'complete' } | { type: 'continue'; nextReason: TurnReasonClaim['reason'] }

async function runTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const started = await startTurn(runtime, state.agentRun.id, claim, options)
	return started.ok ? runStartedTurn(runtime, state, claim, started.value, options) : started
}

interface StartedTurn {
	turnStarted: AgentRunEvent
	modelStarted: AgentRunEvent
}

async function startTurn(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	claim: TurnReasonClaim,
	options: RunModelAgentRunOptions,
): Promise<Result<StartedTurn, AgentRunRuntimeError>> {
	const turnStarted = await appendAndEmit(runtime, agentRunId, turnStartedBody(claim), options)
	if (!turnStarted.ok) return turnStarted

	const modelStarted = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'model-message-started', turnStartedEventId: turnStarted.value.id },
		options,
	)
	return modelStarted.ok ? { ok: true, value: { turnStarted: turnStarted.value, modelStarted: modelStarted.value } } : modelStarted
}

function turnStartedBody(claim: TurnReasonClaim): AgentRunEvent['body'] {
	return { type: 'turn-started', contextThroughSequence: claim.contextThroughSequence, reason: claim.reason }
}

async function runStartedTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	claim: TurnReasonClaim,
	started: StartedTurn,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const outcome = await runProviderTurn(runtime, state, claim.contextThroughSequence, started.modelStarted.id, options)
	return outcome.ok ? finishProviderTurn(runtime, state, started, outcome.value, options) : outcome
}

async function finishProviderTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	started: StartedTurn,
	outcome: AgentRunModelMessageOutcome,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const modelEnded = await appendAndEmit(
		runtime,
		state.agentRun.id,
		{ type: 'model-message-ended', modelMessageStartedEventId: started.modelStarted.id, outcome },
		options,
	)
	return modelEnded.ok ? finishModelOutcomeTurn(runtime, state, started.turnStarted.id, modelEnded.value, outcome, options) : modelEnded
}

async function finishModelOutcomeTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	turnStartedEventId: Id,
	modelEnded: AgentRunEvent,
	outcome: AgentRunModelMessageOutcome,
	options: RunModelAgentRunOptions,
): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const postModel = await processModelOutcome(runtime, state, modelEnded, outcome, options)
	if (!postModel.ok) return postModel

	const turnEnded = await appendAndEmit(runtime, state.agentRun.id, { type: 'turn-ended', turnStartedEventId }, options)
	return turnEnded.ok ? turnResultAfterPostModel(runtime, state.agentRun, postModel.value) : turnEnded
}

function turnResultAfterPostModel(
	runtime: ModelAgentRunRuntime,
	agentRun: AgentRun,
	postModel: PostModelOutcome,
): Promise<Result<TurnResult, AgentRunRuntimeError>> | Result<TurnResult, never> {
	if (postModel.type === 'tool-results')
		return { ok: true, value: { type: 'continue', nextReason: { type: 'tool-results', toolResolutionEventIds: postModel.eventIds } } }
	return postModel.type === 'complete' ? completeAutonomousRunIfNeeded(runtime, agentRun) : { ok: true, value: { type: 'complete' } }
}

async function runProviderTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	contextThroughSequence: number,
	modelMessageStartedEventId: Id,
	options: RunModelAgentRunOptions,
): Promise<Result<AgentRunModelMessageOutcome, AgentRunRuntimeError>> {
	const turnModelUse = await loadTurnModelUse(runtime.services.storage, state.events, contextThroughSequence)
	return turnModelUse.ok
		? runResolvedProviderTurn(runtime, state, contextThroughSequence, modelMessageStartedEventId, options, turnModelUse.value)
		: turnModelUseErrorOutcome(turnModelUse.error)
}

async function runResolvedProviderTurn(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	contextThroughSequence: number,
	modelMessageStartedEventId: Id,
	options: RunModelAgentRunOptions,
	turnModelUse: TurnModelUse,
): Promise<Result<AgentRunModelMessageOutcome, AgentRunRuntimeError>> {
	const modelContext = buildAgentRunModelContext(state.events, contextThroughSequence)
	const result = await runtime.providers.modelProviderProtocols.runModelAgentTurn({
		model: turnModelUse.model,
		modelProvider: turnModelUse.modelProvider,
		messages: modelContext.messages,
		tools: state.tools.map(providerTool),
		thinking: turnModelUse.thinking,
		signal: options.signal ?? new AbortController().signal,
		onDelta(delta) {
			void emit(options, { type: 'model-message-updated', modelMessageStartedEventId, delta })
		},
	})
	return result.ok ? { ok: true, value: result.value.outcome } : result
}

function turnModelUseErrorOutcome(
	error: AgentRunRuntimeError | ModelThinkingLevelUnavailableError,
): Result<AgentRunModelMessageOutcome, AgentRunRuntimeError> {
	return error.type === 'model-thinking-level-unavailable' ? staleThinkingOutcome(error) : { ok: false, error }
}

type TurnModelUse = {
	selection: Extract<AgentRunEvent['body'], { type: 'agent-run-model-selected' }>
	model: Model
	modelProvider: ModelProvider
	thinking: ModelAgentTurnThinking
}

async function loadTurnModelUse(
	storage: CoreStorage,
	events: AgentRunEvent[],
	contextThroughSequence: number,
): Promise<Result<TurnModelUse, AgentRunRuntimeError | ModelThinkingLevelUnavailableError>> {
	const selection = latestModelSelection(events, contextThroughSequence)
	return selection.ok ? loadTurnModelUseSelection(storage, selection.value) : selection
}

async function loadTurnModelUseSelection(
	storage: CoreStorage,
	selection: Extract<AgentRunEvent['body'], { type: 'agent-run-model-selected' }>,
): Promise<Result<TurnModelUse, AgentRunRuntimeError | ModelThinkingLevelUnavailableError>> {
	const model = await getRequired('model', storage, selection.modelId)
	return model.ok ? loadTurnModelUseModel(storage, selection, model.value) : model
}

async function loadTurnModelUseModel(
	storage: CoreStorage,
	selection: Extract<AgentRunEvent['body'], { type: 'agent-run-model-selected' }>,
	model: Model,
): Promise<Result<TurnModelUse, AgentRunRuntimeError | ModelThinkingLevelUnavailableError>> {
	const provider = await getRequired('model-provider', storage, model.providerId)
	return provider.ok ? turnModelUseForProvider(selection, model, provider.value) : provider
}

function turnModelUseForProvider(
	selection: Extract<AgentRunEvent['body'], { type: 'agent-run-model-selected' }>,
	model: Model,
	modelProvider: ModelProvider,
): Result<TurnModelUse, ModelThinkingLevelUnavailableError> {
	const thinking = resolveProviderTurnThinking(model, selection.thinkingLevel)
	return thinking.ok ? { ok: true, value: { selection, model, modelProvider, thinking: thinking.value } } : thinking
}

function resolveProviderTurnThinking(
	model: Model,
	thinkingLevel: ModelThinkingLevel,
): Result<ModelAgentTurnThinking, ModelThinkingLevelUnavailableError> {
	if (model.capabilities.reasoning === null) {
		return thinkingLevel === 'off'
			? { ok: true, value: null }
			: modelThinkingLevelUnavailable(model.id, thinkingLevel, 'model-reasoning-unconfigured')
	}

	const entry = model.capabilities.reasoning[thinkingLevel]
	return entry === null
		? modelThinkingLevelUnavailable(model.id, thinkingLevel, 'thinking-level-unconfigured')
		: { ok: true, value: { level: thinkingLevel, providerValue: entry.value } }
}

function modelThinkingLevelUnavailable(
	modelId: Id,
	thinkingLevel: ModelThinkingLevel,
	reason: ModelThinkingLevelUnavailableError['reason']['type'],
): Result<never, ModelThinkingLevelUnavailableError> {
	return { ok: false, error: { type: 'model-thinking-level-unavailable', modelId, thinkingLevel, reason: { type: reason } } }
}

function staleThinkingOutcome(error: ModelThinkingLevelUnavailableError): Result<AgentRunModelMessageOutcome, never> {
	return {
		ok: true,
		value: {
			type: 'error',
			message: null,
			summary: `Selected thinking level ${error.thinkingLevel} is unavailable for Model ${error.modelId}.`,
		},
	}
}

type PostModelOutcome = { type: 'complete' } | { type: 'waiting' } | { type: 'tool-results'; eventIds: Id[] }

async function processModelOutcome(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	modelEnded: AgentRunEvent,
	outcome: AgentRunModelMessageOutcome,
	options: RunModelAgentRunOptions,
): Promise<Result<PostModelOutcome, AgentRunRuntimeError>> {
	if (outcome.type === 'tool-use')
		return processToolCalls(
			runtime,
			state,
			modelEnded.id,
			outcome.message.content.filter((content) => content.type === 'tool-call'),
			options,
		)
	return { ok: true, value: outcome.type === 'stop' ? { type: 'complete' } : { type: 'waiting' } }
}

async function processToolCalls(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	modelMessageEventId: Id,
	toolCalls: Extract<AgentRunModelMessageOutcome, { type: 'tool-use' }>['message']['content'],
	options: RunModelAgentRunOptions,
): Promise<Result<PostModelOutcome, AgentRunRuntimeError>> {
	const eventIds: Id[] = []
	for (const toolCall of toolCalls) {
		if (toolCall.type !== 'tool-call') continue
		const result = await processToolCall(runtime, state, modelMessageEventId, toolCall, options)
		if (!result.ok) return result
		eventIds.push(result.value)
	}
	return { ok: true, value: { type: 'tool-results', eventIds } }
}

async function processToolCall(
	runtime: ModelAgentRunRuntime,
	state: AgentRunLoopState,
	modelMessageEventId: Id,
	toolCall: Extract<AgentRunModelMessageOutcome, { type: 'tool-use' }>['message']['content'][number] & { type: 'tool-call' },
	options: RunModelAgentRunOptions,
): Promise<Result<Id, AgentRunRuntimeError>> {
	const tool = state.tools.find((candidate) => candidate.name === toolCall.toolName)
	if (tool === undefined) return refuseToolCall(runtime, state.agentRun.id, modelMessageEventId, toolCall, 'unknown-tool', options)

	const input = validateToolInput(tool, toolCall.input)
	if (!input.ok) return refuseToolCall(runtime, state.agentRun.id, modelMessageEventId, toolCall, 'invalid-input', options)

	return executeToolCall(runtime, state.agentRun.id, modelMessageEventId, toolCall, tool, input.value, options)
}

async function refuseToolCall(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	modelMessageEventId: Id,
	toolCall: { toolCallId: Id; toolName: string; input: unknown },
	reason: 'unknown-tool' | 'invalid-input',
	options: RunModelAgentRunOptions,
): Promise<Result<Id, AgentRunRuntimeError>> {
	const scheduled = await appendAndEmit(
		runtime,
		agentRunId,
		{
			type: 'tool-call-scheduled',
			modelMessageEventId,
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
			scheduling: { type: 'refused', reason: { type: reason }, output: toolOutput(`Tool call refused: ${reason}.`) },
		},
		options,
	)
	return scheduled.ok ? { ok: true, value: scheduled.value.id } : scheduled
}

async function executeToolCall(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	modelMessageEventId: Id,
	toolCall: { toolCallId: Id; toolName: string; input: unknown },
	tool: CoreAgentRunTool,
	input: unknown,
	options: RunModelAgentRunOptions,
): Promise<Result<Id, AgentRunRuntimeError>> {
	const scheduled = await appendAndEmit(
		runtime,
		agentRunId,
		{
			type: 'tool-call-scheduled',
			modelMessageEventId,
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
			scheduling: { type: 'accepted', executionMode: tool.executionMode },
		},
		options,
	)
	if (!scheduled.ok) return scheduled

	const started = await appendAndEmit(
		runtime,
		agentRunId,
		{ type: 'tool-call-started', toolCallScheduledEventId: scheduled.value.id, toolCallId: toolCall.toolCallId },
		options,
	)
	if (!started.ok) return started

	const output = await executeTool(runtime, agentRunId, scheduled.value.id, started.value.id, tool, input, options)
	const ended = await appendAndEmit(
		runtime,
		agentRunId,
		{
			type: 'tool-call-ended',
			toolCallScheduledEventId: scheduled.value.id,
			toolCallId: toolCall.toolCallId,
			outcome: { type: 'success', output },
		},
		options,
	)
	return ended.ok ? { ok: true, value: ended.value.id } : ended
}

async function executeTool(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	toolCallScheduledEventId: Id,
	toolCallStartedEventId: Id,
	tool: CoreAgentRunTool,
	input: unknown,
	options: RunModelAgentRunOptions,
): Promise<AgentRunToolOutput> {
	return tool.execute(input, {
		agentRunId,
		toolCallScheduledEventId,
		signal: options.signal ?? new AbortController().signal,
		onUpdate(update) {
			void emit(options, { type: 'tool-call-updated', toolCallStartedEventId, update })
		},
		recordProposal(body) {
			return recordToolProposal(runtime, agentRunId, toolCallScheduledEventId, body)
		},
	})
}

async function recordToolProposal(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	toolCallScheduledEventId: Id,
	body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown },
): Promise<AgentRunToolOutput> {
	const eventBody =
		body.type === 'proposed-plan-output'
			? { type: body.type, toolCallScheduledEventId, output: body.output as never }
			: { type: body.type, toolCallScheduledEventId, output: body.output as never }
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, eventBody)
	return event.ok
		? toolOutput(`${body.type} recorded for human review as event ${event.value.id}.`)
		: toolOutput(`Failed to record proposal: ${event.error.type}.`)
}

function completeAutonomousRunIfNeeded(
	runtime: ModelAgentRunRuntime,
	agentRun: AgentRun,
): Promise<Result<TurnResult, AgentRunRuntimeError>> | Result<TurnResult, never> {
	return agentRun.purpose.type === 'execution' || agentRun.purpose.type === 'revision-execution'
		? completeAgentRun(runtime, agentRun)
		: { ok: true, value: { type: 'complete' } }
}

async function completeAgentRun(runtime: ModelAgentRunRuntime, agentRun: AgentRun): Promise<Result<TurnResult, AgentRunRuntimeError>> {
	const completed = { at: runtime.values.now().toISOString() }
	const updated = await withTransaction(runtime.services, (storage) => updateRecord('agent-run', storage, agentRun.id, { completed }))
	return updated.ok ? { ok: true, value: { type: 'complete' } } : updated
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

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedSelectableModel } = await import('../../utils/test-helpers')

	describe('runModelAgentRun', () => {
		it('runs input to stop and completes autonomous Agent Runs', async () => {
			const services = executionFixture()
			const runtime = modelLoopRuntime(services, modelProviders([stopOutcome('Done.')]))

			const result = await runModelAgentRun(runtime, 'agent-run-1')

			expect(result).toEqual({ ok: true, value: undefined })
			expect(services.tx.agentRuns.records.get('agent-run-1')?.completed).toEqual({ at: '2026-06-10T12:00:00.000Z' })
			expect([...services.tx.agentRunEvents.records.values()].map((event) => event.body.type)).toContain('model-message-ended')
		})

		it('records proposal tool calls and continues to a tool-results stop turn', async () => {
			const services = planningFixture()
			const runtime = modelLoopRuntime(services, modelProviders([toolUseOutcome(), stopOutcome('Recorded.')]))

			const result = await runModelAgentRun(runtime, 'agent-run-1')

			expect(result).toEqual({ ok: true, value: undefined })
			expect([...services.tx.agentRunEvents.records.values()].map((event) => event.body.type)).toEqual([
				'agent-run-model-selected',
				'input-message',
				'turn-started',
				'model-message-started',
				'model-message-ended',
				'tool-call-scheduled',
				'tool-call-started',
				'proposed-plan-output',
				'tool-call-ended',
				'turn-ended',
				'turn-started',
				'model-message-started',
				'model-message-ended',
				'turn-ended',
			])
		})

		it('refuses unknown tool calls and blocks after operator interrupts until new input', async () => {
			const services = planningFixture()
			services.tx.agentRunEvents.records.set('interrupt', {
				id: 'interrupt',
				agentRunId: 'agent-run-1',
				sequence: 3,
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: {
					type: 'interrupt-requested',
					source: { type: 'operator', authorized: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' } },
					reason: null,
				},
			})
			const runtime = modelLoopRuntime(services, modelProviders([unknownToolUseOutcome()]))

			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toEqual({ ok: true, value: undefined })
			expect([...services.tx.agentRunEvents.records.values()].some((event) => event.body.type === 'model-message-ended')).toBe(false)

			services.tx.agentRunEvents.records.set('input-2', {
				id: 'input-2',
				agentRunId: 'agent-run-1',
				sequence: 4,
				occurred: { at: '2026-06-10T12:00:00.000Z' },
				body: { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'continue' }] },
			})
			await expect(runModelAgentRun(runtime, 'agent-run-1')).resolves.toEqual({ ok: true, value: undefined })
			expect(
				[...services.tx.agentRunEvents.records.values()].find((event) => event.body.type === 'tool-call-scheduled')?.body,
			).toMatchObject({ scheduling: { type: 'refused' } })
		})
	})

	function executionFixture() {
		const services = createTestCoreServices()
		seedSelectableModel(services.tx, 'model-1')
		services.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'execution', deliveryId: 'delivery-1', sliceId: 'slice-1', mode: { type: 'initial' } },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		seedInitialEvents(services)
		return services
	}

	function planningFixture() {
		const services = createTestCoreServices()
		seedSelectableModel(services.tx, 'model-1')
		services.tx.agentRuns.records.set('agent-run-1', {
			id: 'agent-run-1',
			agent: { type: 'model' },
			purpose: { type: 'planning', planId: 'plan-1' },
			started: { at: '2026-06-10T12:00:00.000Z' },
			completed: null,
		})
		seedInitialEvents(services)
		return services
	}

	function seedInitialEvents(services: ReturnType<typeof createTestCoreServices>) {
		services.tx.agentRunEvents.records.set('model-selection', {
			id: 'model-selection',
			agentRunId: 'agent-run-1',
			sequence: 1,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'agent-run-model-selected',
				modelId: 'model-1',
				thinkingLevel: 'off',
				authorized: null,
			},
		})
		services.tx.agentRunEvents.records.set('input-1', {
			id: 'input-1',
			agentRunId: 'agent-run-1',
			sequence: 2,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: { type: 'input-message', source: { type: 'runtime' }, content: [{ type: 'text', text: 'start' }] },
		})
	}

	function modelLoopRuntime(
		services: ReturnType<typeof createTestCoreServices>,
		providers: ReturnType<typeof modelProviders>,
	): ModelAgentRunRuntime {
		return { services, providers, values: services.values }
	}

	function modelProviders(outcomes: AgentRunModelMessageOutcome[]) {
		let index = 0
		return {
			sourceControl: {
				preflightRepository: () => Promise.reject(new Error('unused')),
				createArtifactBranch: () => Promise.reject(new Error('unused')),
				createReviewSurface: () => Promise.reject(new Error('unused')),
			},
			modelProviderProtocols: {
				preflightModel: () => Promise.reject(new Error('unused')),
				runModelAgentTurn: () =>
					Promise.resolve({ ok: true as const, value: { outcome: outcomes[index++] ?? stopOutcome('fallback') } }),
			},
		}
	}

	function stopOutcome(text: string): AgentRunModelMessageOutcome {
		return { type: 'stop', message: { content: [{ type: 'text', text }], usage: null, providerResponseRef: null } }
	}

	function toolUseOutcome(): AgentRunModelMessageOutcome {
		return {
			type: 'tool-use',
			message: {
				content: [
					{
						type: 'tool-call',
						toolCallId: 'tool-call-1',
						toolName: 'propose-plan-output',
						input: {
							proposedDeliveries: {},
							proposedMemoryCreations: { m: { parentId: null, title: 'M', body: 'B', children: {} } },
							proposedMemoryRevisions: {},
						},
					},
				],
				usage: null,
				providerResponseRef: null,
			},
		}
	}

	function unknownToolUseOutcome(): AgentRunModelMessageOutcome {
		return {
			type: 'tool-use',
			message: {
				content: [{ type: 'tool-call', toolCallId: 'tool-call-1', toolName: 'unknown', input: {} }],
				usage: null,
				providerResponseRef: null,
			},
		}
	}
}
