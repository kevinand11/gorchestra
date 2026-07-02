import OpenAI from 'openai'
import { v } from 'valleyed'

import { providerFailurePreflight } from './provider-failures'
import type {
	ModelAgentTurnOutput,
	ModelProviderProtocolAccess,
	ModelProviderProtocolProvider,
	ModelProviderProtocolProviderModelAgentTurnInput,
	ModelProviderProtocolProviderPreflightModelInput,
} from './types'
import type { AgentRunModelContent, AgentRunModelMessage, AgentRunModelMessageOutcome, AgentRunModelUsage } from '../../domain/agent-run'
import type { AgentRunProviderMessage, AgentRunProviderTool } from '../../runtime/agent-runs/types'

export type OpenAIResponsesModelProviderProtocolProvider = ModelProviderProtocolProvider<'openai-responses'>

type OpenAIResponsesPreflightInput = ModelProviderProtocolProviderPreflightModelInput<'openai-responses'>
type OpenAIResponsesTurnInput = ModelProviderProtocolProviderModelAgentTurnInput<'openai-responses'>
type OpenAIResponsesClientInput = { modelProvider: OpenAIResponsesPreflightInput['modelProvider']; access: ModelProviderProtocolAccess }

type OpenAIResponsesRequestOptions = { signal?: AbortSignal }
type OpenAIResponsesCreateResult = { withResponse(): Promise<OpenAIResponsesWithResponse> }

type OpenAIResponsesClient = {
	models: { retrieve(model: string): Promise<unknown> }
	responses: { create(params: OpenAIResponsesRequest, options?: OpenAIResponsesRequestOptions): OpenAIResponsesCreateResult }
}

type OpenAIResponsesClientFactory = (input: OpenAIResponsesClientInput) => OpenAIResponsesClient

type OpenAIResponsesRequest = {
	model: string
	input: unknown[]
	stream: true
	store: false
	tools?: unknown[]
}

type OpenAIResponsesWithResponse = {
	data: AsyncIterable<OpenAIResponsesStreamEvent>
	response: { status: number; headers?: unknown }
}

type OpenAIResponsesStreamEvent =
	| { type: 'response.created'; response: { id?: string } }
	| { type: 'response.output_item.added'; item: OpenAIResponsesOutputItem }
	| { type: 'response.reasoning_summary_part.added'; part: OpenAIResponsesReasoningTextPart }
	| { type: 'response.reasoning_summary_text.delta'; delta: string }
	| { type: 'response.reasoning_summary_part.done' }
	| { type: 'response.reasoning_text.delta'; delta: string }
	| { type: 'response.content_part.added'; part: OpenAIResponsesMessageContent }
	| { type: 'response.output_text.delta'; delta: string }
	| { type: 'response.refusal.delta'; delta: string }
	| { type: 'response.function_call_arguments.delta'; delta: string }
	| { type: 'response.function_call_arguments.done'; arguments: string }
	| { type: 'response.output_item.done'; item: OpenAIResponsesOutputItem }
	| { type: 'response.completed'; response: OpenAIResponsesTerminalResponse }
	| { type: 'response.incomplete'; response: OpenAIResponsesTerminalResponse }
	| { type: 'response.failed'; response?: OpenAIResponsesTerminalResponse & { error?: { code?: string; message?: string } } }
	| { type: 'error'; code?: string; message?: string }

type OpenAIResponsesOutputItem = OpenAIResponsesReasoningItem | OpenAIResponsesMessageItem | OpenAIResponsesFunctionCallItem

type OpenAIResponsesReasoningTextPart = { type?: string; text: string }

type OpenAIResponsesReasoningItem = {
	type: 'reasoning'
	id?: string
	summary?: OpenAIResponsesReasoningTextPart[]
	content?: OpenAIResponsesReasoningTextPart[]
}

type OpenAIResponsesMessageContent = { type: 'output_text'; text: string; annotations?: unknown[] } | { type: 'refusal'; refusal: string }

type OpenAIResponsesMessageItem = {
	type: 'message'
	id?: string
	content?: OpenAIResponsesMessageContent[]
	phase?: 'commentary' | 'final_answer'
}

type OpenAIResponsesFunctionCallItem = {
	type: 'function_call'
	id?: string
	call_id?: string
	name?: string
	arguments?: string
}

type OpenAIResponsesTerminalResponse = {
	id?: string
	status?: 'completed' | 'incomplete' | 'failed' | 'cancelled' | 'in_progress' | 'queued'
	usage?: OpenAIResponsesUsage
	incomplete_details?: { reason?: string }
}

type OpenAIResponsesUsage = {
	input_tokens?: number
	output_tokens?: number
	total_tokens?: number
	input_tokens_details?: { cached_tokens?: number }
}

type TerminalStatus = 'completed' | 'incomplete' | 'failed'

type StreamBlockState =
	| { type: 'text'; contentIndex: number }
	| { type: 'thinking'; contentIndex: number; item: OpenAIResponsesReasoningItem }
	| { type: 'tool-call'; contentIndex: number; partialJson: string }

interface StreamState {
	content: AgentRunModelContent[]
	providerResponseRef: string | null
	usage: AgentRunModelUsage | null
	terminalStatus: TerminalStatus | null
	currentBlock: StreamBlockState | null
	started: boolean
	ended: boolean
}

const jsonPipe = v.fromJson(v.any<unknown>())

export function createOpenAIResponsesModelProviderProtocolProvider(
	clientFactory: OpenAIResponsesClientFactory = createOpenAIResponsesClient,
): OpenAIResponsesModelProviderProtocolProvider {
	return {
		async preflightModel(input) {
			try {
				await clientFactory(input).models.retrieve(input.model.providerModelId)
				return { type: 'passed' }
			} catch (error) {
				return providerFailurePreflight(error)
			}
		},
		runModelAgentTurn(input) {
			return runOpenAIResponsesModelAgentTurn(clientFactory, input)
		},
	}
}

function createOpenAIResponsesClient(input: OpenAIResponsesClientInput): OpenAIResponsesClient {
	return new OpenAI({
		apiKey: input.access.auth?.plaintext ?? 'unused',
		baseURL: input.modelProvider.baseUrl,
		defaultHeaders: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	}) as unknown as OpenAIResponsesClient
}

async function runOpenAIResponsesModelAgentTurn(
	clientFactory: OpenAIResponsesClientFactory,
	input: OpenAIResponsesTurnInput,
): Promise<ModelAgentTurnOutput> {
	const state = initialStreamState()
	try {
		const response = await createStreamResponse(clientFactory, input)
		startModelOutput(state, input)
		await processResponsesStream(response.data, state, input)
		if (state.terminalStatus === null) throw new Error('OpenAI Responses stream ended before a terminal response event.')
		endModelOutput(state, input)
		return { outcome: outcomeFromStreamState(state) }
	} catch (error) {
		if (state.started) endModelOutput(state, input)
		return { outcome: errorOutcome(state, input.signal, error) }
	}
}

async function createStreamResponse(
	clientFactory: OpenAIResponsesClientFactory,
	input: OpenAIResponsesTurnInput,
): Promise<OpenAIResponsesWithResponse> {
	return clientFactory(input).responses.create(openAIResponsesRequest(input), { signal: input.signal }).withResponse()
}

function openAIResponsesRequest(input: OpenAIResponsesTurnInput): OpenAIResponsesRequest {
	const tools = input.tools.length === 0 ? undefined : input.tools.map(openAIResponsesTool)
	return {
		model: input.model.providerModelId,
		input: input.messages.map(openAIResponsesMessage),
		stream: true,
		store: false,
		...(tools === undefined ? {} : { tools }),
	}
}

function openAIResponsesMessage(message: AgentRunProviderMessage): unknown {
	const inputText = { type: 'input_text', text: message.content }
	const roleMessages = {
		system: () => ({ role: 'system', content: message.content }),
		user: () => ({ role: 'user', content: [inputText] }),
		tool: () => ({ role: 'user', content: [{ type: 'input_text', text: `Tool result:\n${message.content}` }] }),
		assistant: () => ({ type: 'message', role: 'assistant', content: [outputText(message.content)], status: 'completed' }),
	} satisfies Record<AgentRunProviderMessage['role'], () => unknown>
	return roleMessages[message.role]()
}

function outputText(text: string): unknown {
	return { type: 'output_text', text, annotations: [] }
}

function openAIResponsesTool(tool: AgentRunProviderTool): unknown {
	return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }
}

function initialStreamState(): StreamState {
	return { content: [], providerResponseRef: null, usage: null, terminalStatus: null, currentBlock: null, started: false, ended: false }
}

async function processResponsesStream(
	stream: AsyncIterable<OpenAIResponsesStreamEvent>,
	state: StreamState,
	input: OpenAIResponsesTurnInput,
): Promise<void> {
	for await (const event of stream) {
		processResponsesStreamEvent(event, state, input)
	}
}

function processResponsesStreamEvent(event: OpenAIResponsesStreamEvent, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const processors = responseStreamEventProcessors(state, input)
	processors[event.type](event as never)
}

function responseStreamEventProcessors(state: StreamState, input: OpenAIResponsesTurnInput) {
	return {
		'response.created': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.created' }>) => {
			state.providerResponseRef = event.response.id ?? state.providerResponseRef
		},
		'response.output_item.added': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.output_item.added' }>) =>
			startOutputItem(event.item, state, input),
		'response.reasoning_summary_part.added': (
			event: Extract<OpenAIResponsesStreamEvent, { type: 'response.reasoning_summary_part.added' }>,
		) => addReasoningSummaryPart(state, event.part),
		'response.reasoning_summary_text.delta': (
			event: Extract<OpenAIResponsesStreamEvent, { type: 'response.reasoning_summary_text.delta' }>,
		) => appendThinkingDelta(state, input, event.delta),
		'response.reasoning_summary_part.done': () => appendThinkingDelta(state, input, '\n\n'),
		'response.reasoning_text.delta': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.reasoning_text.delta' }>) =>
			appendThinkingDelta(state, input, event.delta),
		'response.content_part.added': () => undefined,
		'response.output_text.delta': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.output_text.delta' }>) =>
			appendTextDelta(state, input, event.delta),
		'response.refusal.delta': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.refusal.delta' }>) =>
			appendTextDelta(state, input, event.delta),
		'response.function_call_arguments.delta': (
			event: Extract<OpenAIResponsesStreamEvent, { type: 'response.function_call_arguments.delta' }>,
		) => appendToolCallDelta(state, input, event.delta),
		'response.function_call_arguments.done': (
			event: Extract<OpenAIResponsesStreamEvent, { type: 'response.function_call_arguments.done' }>,
		) => finishToolCallArguments(state, input, event.arguments),
		'response.output_item.done': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.output_item.done' }>) =>
			finishOutputItem(event.item, state, input),
		'response.completed': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.completed' }>) =>
			finishTerminalResponse(state, event.response, 'completed'),
		'response.incomplete': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.incomplete' }>) =>
			finishTerminalResponse(state, event.response, 'incomplete'),
		'response.failed': (event: Extract<OpenAIResponsesStreamEvent, { type: 'response.failed' }>) => {
			finishTerminalResponse(state, event.response ?? {}, 'failed')
			throw new Error(responseFailedSummary(event.response))
		},
		error: (event: Extract<OpenAIResponsesStreamEvent, { type: 'error' }>) => {
			throw new Error(event.message ?? event.code ?? 'OpenAI Responses stream error.')
		},
	} satisfies Record<OpenAIResponsesStreamEvent['type'], (event: never) => void>
}

function startOutputItem(item: OpenAIResponsesOutputItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const starters = {
		reasoning: () => startThinkingItem(item as OpenAIResponsesReasoningItem, state, input),
		message: () => startTextItem(state, input),
		function_call: () => startToolCallItem(item as OpenAIResponsesFunctionCallItem, state, input),
	} satisfies Record<OpenAIResponsesOutputItem['type'], () => void>
	starters[item.type]()
}

function startThinkingItem(item: OpenAIResponsesReasoningItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const contentIndex = pushContent(state, { type: 'thinking', text: '', providerReplay: null })
	state.currentBlock = { type: 'thinking', contentIndex, item }
	input.onDelta({ type: 'thinking-started', contentIndex })
}

function startTextItem(state: StreamState, input: OpenAIResponsesTurnInput): void {
	const contentIndex = pushContent(state, { type: 'text', text: '' })
	state.currentBlock = { type: 'text', contentIndex }
	input.onDelta({ type: 'text-started', contentIndex })
}

function startToolCallItem(item: OpenAIResponsesFunctionCallItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const toolCallId = openAIToolCallId(item)
	const toolName = item.name ?? 'unknown'
	const partialJson = item.arguments ?? ''
	const contentIndex = pushContent(state, { type: 'tool-call', toolCallId, toolName, input: parseToolInput(partialJson) })
	state.currentBlock = { type: 'tool-call', contentIndex, partialJson }
	input.onDelta({ type: 'tool-call-arguments-started', contentIndex, toolCallId, toolName })
}

function finishOutputItem(item: OpenAIResponsesOutputItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const finishers = {
		reasoning: () => finishThinkingItem(item as OpenAIResponsesReasoningItem, state, input),
		message: () => finishTextItem(item as OpenAIResponsesMessageItem, state, input),
		function_call: () => finishToolCallItem(item as OpenAIResponsesFunctionCallItem, state, input),
	} satisfies Record<OpenAIResponsesOutputItem['type'], () => void>
	finishers[item.type]()
}

function finishThinkingItem(item: OpenAIResponsesReasoningItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const block = currentContent(state, 'thinking')
	if (block === null) return

	block.content.text = reasoningText(item) || block.content.text
	block.content.providerReplay = stringifyJson(item)
	state.currentBlock = null
	input.onDelta({ type: 'thinking-ended', contentIndex: block.index, text: block.content.text })
}

function finishTextItem(item: OpenAIResponsesMessageItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const block = currentContent(state, 'text')
	if (block === null) return

	block.content.text = messageText(item) || block.content.text
	state.currentBlock = null
	input.onDelta({ type: 'text-ended', contentIndex: block.index, text: block.content.text })
}

function finishToolCallItem(item: OpenAIResponsesFunctionCallItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	const block = currentToolCallContent(state)
	if (block === null) return

	block.content.input = parseToolInput(finalToolCallJson(item, state.currentBlock))
	state.currentBlock = null
	emitToolCallArgumentsEnded(input, block)
}

function finalToolCallJson(item: OpenAIResponsesFunctionCallItem, block: StreamBlockState | null): string {
	return item.arguments ?? currentPartialJson(block)
}

function currentPartialJson(block: StreamBlockState | null): string {
	return block?.type === 'tool-call' ? block.partialJson : ''
}

function emitToolCallArgumentsEnded(
	input: OpenAIResponsesTurnInput,
	block: { index: number; content: Extract<AgentRunModelContent, { type: 'tool-call' }> },
): void {
	input.onDelta({
		type: 'tool-call-arguments-ended',
		contentIndex: block.index,
		toolCallId: block.content.toolCallId,
		toolName: block.content.toolName,
		input: block.content.input,
	})
}

function addReasoningSummaryPart(state: StreamState, part: OpenAIResponsesReasoningTextPart): void {
	if (state.currentBlock?.type !== 'thinking') return
	state.currentBlock.item.summary = [...(state.currentBlock.item.summary ?? []), part]
}

function appendThinkingDelta(state: StreamState, input: OpenAIResponsesTurnInput, delta: string): void {
	const block = currentContent(state, 'thinking')
	if (block === null) return

	block.content.text += delta
	appendReasoningPartText(state.currentBlock, delta)
	input.onDelta({ type: 'thinking-delta', contentIndex: block.index, delta })
}

function appendReasoningPartText(block: StreamBlockState | null, delta: string): void {
	if (block?.type !== 'thinking') return
	const last = block.item.summary?.at(-1)
	if (last !== undefined) last.text += delta
}

function appendTextDelta(state: StreamState, input: OpenAIResponsesTurnInput, delta: string): void {
	const block = currentContent(state, 'text')
	if (block === null) return

	block.content.text += delta
	input.onDelta({ type: 'text-delta', contentIndex: block.index, delta })
}

function appendToolCallDelta(state: StreamState, input: OpenAIResponsesTurnInput, delta: string): void {
	const block = currentContent(state, 'tool-call')
	if (block === null || state.currentBlock?.type !== 'tool-call') return

	state.currentBlock.partialJson += delta
	block.content.input = parseToolInput(state.currentBlock.partialJson)
	input.onDelta({ type: 'tool-call-arguments-delta', contentIndex: block.index, toolCallId: block.content.toolCallId, delta })
}

function finishToolCallArguments(state: StreamState, input: OpenAIResponsesTurnInput, finalJson: string): void {
	const block = currentToolCallContent(state)
	if (block === null || state.currentBlock?.type !== 'tool-call') return

	const previousJson = state.currentBlock.partialJson
	state.currentBlock.partialJson = finalJson
	block.content.input = parseToolInput(finalJson)
	emitRemainingToolCallArgumentsDelta(input, block, previousJson, finalJson)
}

function emitRemainingToolCallArgumentsDelta(
	input: OpenAIResponsesTurnInput,
	block: { index: number; content: Extract<AgentRunModelContent, { type: 'tool-call' }> },
	previousJson: string,
	finalJson: string,
): void {
	const delta = trailingDelta(previousJson, finalJson)
	if (delta === null) return

	input.onDelta({ type: 'tool-call-arguments-delta', contentIndex: block.index, toolCallId: block.content.toolCallId, delta })
}

function trailingDelta(previous: string, current: string): string | null {
	return current.startsWith(previous) && current.length > previous.length ? current.slice(previous.length) : null
}

function finishTerminalResponse(state: StreamState, response: OpenAIResponsesTerminalResponse, fallback: TerminalStatus): void {
	state.providerResponseRef = response.id ?? state.providerResponseRef
	state.usage = usageFromOpenAIResponse(response.usage)
	state.terminalStatus = terminalStatus(response.status) ?? fallback
}

function startModelOutput(state: StreamState, input: OpenAIResponsesTurnInput): void {
	state.started = true
	input.onDelta({ type: 'model-output-started' })
}

function endModelOutput(state: StreamState, input: OpenAIResponsesTurnInput): void {
	if (!state.started || state.ended) return
	state.ended = true
	input.onDelta({ type: 'model-output-ended' })
}

function outcomeFromStreamState(state: StreamState): AgentRunModelMessageOutcome {
	if (state.terminalStatus === 'failed')
		return { type: 'error', message: modelMessageOrNull(state), summary: 'OpenAI Responses request failed.' }

	const message = modelMessage(state)
	if (state.terminalStatus === 'incomplete') return { type: 'length', message, summary: null }
	return message.content.some((content) => content.type === 'tool-call') ? { type: 'tool-use', message } : { type: 'stop', message }
}

function errorOutcome(state: StreamState, signal: AbortSignal, error: unknown): AgentRunModelMessageOutcome {
	return {
		type: 'error',
		message: modelMessageOrNull(state),
		summary: signal.aborted ? 'Request was aborted without an interrupt event.' : errorSummary(error),
	}
}

function modelMessageOrNull(state: StreamState): AgentRunModelMessage | null {
	return state.content.length === 0 ? null : modelMessage(state)
}

function modelMessage(state: StreamState): AgentRunModelMessage {
	return { content: state.content, usage: state.usage, providerResponseRef: state.providerResponseRef }
}

function pushContent<TContent extends AgentRunModelContent>(state: StreamState, content: TContent): number {
	state.content.push(content)
	return state.content.length - 1
}

function currentContent<TType extends AgentRunModelContent['type']>(
	state: StreamState,
	type: TType,
): { index: number; content: Extract<AgentRunModelContent, { type: TType }> } | null {
	const index = currentContentIndex(state)
	return index === null ? null : contentAtIndex(state, index, type)
}

function currentContentIndex(state: StreamState): number | null {
	return state.currentBlock === null ? null : state.currentBlock.contentIndex
}

function contentAtIndex<TType extends AgentRunModelContent['type']>(
	state: StreamState,
	index: number,
	type: TType,
): { index: number; content: Extract<AgentRunModelContent, { type: TType }> } | null {
	const content = state.content[index]
	return content?.type === type ? { index, content: content as Extract<AgentRunModelContent, { type: TType }> } : null
}

function currentToolCallContent(
	state: StreamState,
): { index: number; content: Extract<AgentRunModelContent, { type: 'tool-call' }> } | null {
	return currentContent(state, 'tool-call')
}

function openAIToolCallId(item: OpenAIResponsesFunctionCallItem): string {
	return `${item.call_id ?? 'call'}|${item.id ?? 'fc'}`
}

function reasoningText(item: OpenAIResponsesReasoningItem): string {
	return textParts(item.summary) || textParts(item.content)
}

function messageText(item: OpenAIResponsesMessageItem): string {
	return (item.content ?? []).map(messageContentText).join('')
}

function messageContentText(content: OpenAIResponsesMessageContent): string {
	return content.type === 'output_text' ? content.text : content.refusal
}

function textParts(parts: OpenAIResponsesReasoningTextPart[] | undefined): string {
	return parts?.map((part) => part.text).join('\n\n') ?? ''
}

function parseToolInput(json: string): unknown {
	if (json.trim().length === 0) return {}

	const result = v.validate(jsonPipe, json)
	return result.valid ? result.value : json
}

function stringifyJson(value: unknown): string | null {
	try {
		return JSON.stringify(value)
	} catch {
		return null
	}
}

function usageFromOpenAIResponse(usage: OpenAIResponsesUsage | undefined): AgentRunModelUsage | null {
	return usage === undefined ? null : usageFromPresentOpenAIResponse(usage)
}

function usageFromPresentOpenAIResponse(usage: OpenAIResponsesUsage): AgentRunModelUsage {
	return {
		inputTokens: inputTokens(usage),
		outputTokens: outputTokens(usage),
		cacheReadTokens: cacheReadTokens(usage),
		cacheWriteTokens: 0,
		totalTokens: totalTokens(usage),
		cost: null,
	}
}

function inputTokens(usage: OpenAIResponsesUsage): number {
	return Math.max(numberOrZero(usage.input_tokens) - cacheReadTokens(usage), 0)
}

function outputTokens(usage: OpenAIResponsesUsage): number {
	return numberOrZero(usage.output_tokens)
}

function cacheReadTokens(usage: OpenAIResponsesUsage): number {
	return numberOrZero(usage.input_tokens_details?.cached_tokens)
}

function totalTokens(usage: OpenAIResponsesUsage): number {
	return usage.total_tokens === undefined ? inputTokens(usage) + outputTokens(usage) + cacheReadTokens(usage) : usage.total_tokens
}

function numberOrZero(value: number | undefined): number {
	return value ?? 0
}

function terminalStatus(status: OpenAIResponsesTerminalResponse['status'] | undefined): TerminalStatus | null {
	const statuses = {
		completed: 'completed',
		incomplete: 'incomplete',
		failed: 'failed',
		cancelled: 'failed',
		in_progress: 'completed',
		queued: 'completed',
	} satisfies Record<NonNullable<OpenAIResponsesTerminalResponse['status']>, TerminalStatus>
	return status === undefined ? null : statuses[status]
}

function responseFailedSummary(
	response: (OpenAIResponsesTerminalResponse & { error?: { code?: string; message?: string } }) | undefined,
): string {
	return response === undefined ? 'OpenAI Responses request failed.' : presentResponseFailedSummary(response)
}

function presentResponseFailedSummary(response: OpenAIResponsesTerminalResponse & { error?: { code?: string; message?: string } }): string {
	return response.error === undefined ? responseIncompleteSummary(response) : responseErrorSummary(response.error)
}

function responseErrorSummary(error: { code?: string; message?: string }): string {
	return `${error.code ?? 'unknown'}: ${error.message ?? 'no message'}`
}

function responseIncompleteSummary(response: OpenAIResponsesTerminalResponse): string {
	return response.incomplete_details?.reason === undefined
		? 'OpenAI Responses request failed.'
		: `incomplete: ${response.incomplete_details.reason}`
}

function errorSummary(error: unknown): string {
	if (error instanceof Error) return error.message
	return stringifyJson(error) ?? String(error)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('OpenAI Responses Model Provider Protocol provider', () => {
		it('streams text into a stop outcome', async () => {
			const deltas: unknown[] = []
			let request: OpenAIResponsesRequest | null = null
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client((params) => {
					request = params
					return withResponse([
						{ type: 'response.created', response: { id: 'resp-1' } },
						{ type: 'response.output_item.added', item: { type: 'message', id: 'msg-1', content: [] } },
						{ type: 'response.content_part.added', part: { type: 'output_text', text: '', annotations: [] } },
						{ type: 'response.output_text.delta', delta: 'Hello' },
						{
							type: 'response.output_item.done',
							item: { type: 'message', id: 'msg-1', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] },
						},
						{
							type: 'response.completed',
							response: {
								id: 'resp-1',
								status: 'completed',
								usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 2 } },
							},
						},
					])
				}),
			)

			const result = await provider.runModelAgentTurn!(turnInput({ onDelta: (delta) => deltas.push(delta) }))

			expect(request).toMatchObject({ model: 'gpt-5', stream: true, store: false })
			expect(result).toEqual({
				outcome: {
					type: 'stop',
					message: {
						content: [{ type: 'text', text: 'Hello' }],
						usage: {
							inputTokens: 10,
							outputTokens: 3,
							cacheReadTokens: 2,
							cacheWriteTokens: 0,
							totalTokens: 15,
							cost: null,
						},
						providerResponseRef: 'resp-1',
					},
				},
			})
			expect(deltas).toEqual([
				{ type: 'model-output-started' },
				{ type: 'text-started', contentIndex: 0 },
				{ type: 'text-delta', contentIndex: 0, delta: 'Hello' },
				{ type: 'text-ended', contentIndex: 0, text: 'Hello' },
				{ type: 'model-output-ended' },
			])
		})

		it('streams function calls into a tool-use outcome', async () => {
			const deltas: unknown[] = []
			const toolInput = { proposedDeliveries: [], proposedMemories: [] }
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client(() =>
					withResponse([
						{
							type: 'response.output_item.added',
							item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'propose-plan-output', arguments: '' },
						},
						{ type: 'response.function_call_arguments.delta', delta: '{"proposedDeliveries":[]' },
						{ type: 'response.function_call_arguments.delta', delta: ',"proposedMemories":[]}' },
						{ type: 'response.function_call_arguments.done', arguments: JSON.stringify(toolInput) },
						{
							type: 'response.output_item.done',
							item: {
								type: 'function_call',
								id: 'fc-1',
								call_id: 'call-1',
								name: 'propose-plan-output',
								arguments: JSON.stringify(toolInput),
							},
						},
						{ type: 'response.completed', response: { id: 'resp-1', status: 'completed' } },
					]),
				),
			)

			const result = await provider.runModelAgentTurn!(turnInput({ onDelta: (delta) => deltas.push(delta) }))

			expect(result.outcome).toEqual({
				type: 'tool-use',
				message: {
					content: [{ type: 'tool-call', toolCallId: 'call-1|fc-1', toolName: 'propose-plan-output', input: toolInput }],
					usage: null,
					providerResponseRef: 'resp-1',
				},
			})
			expect(deltas).toContainEqual({
				type: 'tool-call-arguments-started',
				contentIndex: 0,
				toolCallId: 'call-1|fc-1',
				toolName: 'propose-plan-output',
			})
			expect(deltas).toContainEqual({
				type: 'tool-call-arguments-ended',
				contentIndex: 0,
				toolCallId: 'call-1|fc-1',
				toolName: 'propose-plan-output',
				input: toolInput,
			})
		})

		it('preserves reasoning replay metadata', async () => {
			const reasoningItem: OpenAIResponsesReasoningItem = { type: 'reasoning', id: 'rs-1', summary: [{ text: 'Think' }] }
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client(() =>
					withResponse([
						{ type: 'response.output_item.added', item: { type: 'reasoning', id: 'rs-1', summary: [] } },
						{ type: 'response.reasoning_summary_part.added', part: { text: '' } },
						{ type: 'response.reasoning_summary_text.delta', delta: 'Think' },
						{ type: 'response.output_item.done', item: reasoningItem },
						{ type: 'response.completed', response: { id: 'resp-1', status: 'completed' } },
					]),
				),
			)

			const result = await provider.runModelAgentTurn!(turnInput())

			expect(result.outcome).toEqual({
				type: 'stop',
				message: {
					content: [{ type: 'thinking', text: 'Think', providerReplay: JSON.stringify(reasoningItem) }],
					usage: null,
					providerResponseRef: 'resp-1',
				},
			})
		})
	})

	function client(create: (params: OpenAIResponsesRequest) => OpenAIResponsesWithResponse): OpenAIResponsesClient {
		return {
			models: { retrieve: () => Promise.resolve({}) },
			responses: {
				create(params) {
					return { withResponse: () => Promise.resolve(create(params)) }
				},
			},
		}
	}

	function withResponse(events: OpenAIResponsesStreamEvent[]): OpenAIResponsesWithResponse {
		return { data: asyncEvents(events), response: { status: 200 } }
	}

	async function* asyncEvents(events: OpenAIResponsesStreamEvent[]): AsyncIterable<OpenAIResponsesStreamEvent> {
		for (const event of events) {
			await Promise.resolve()
			yield event
		}
	}

	function turnInput(overrides: Partial<OpenAIResponsesTurnInput> = {}): OpenAIResponsesTurnInput {
		return {
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'GPT 5',
				providerModelId: 'gpt-5',
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'OpenAI',
				protocol: { type: 'openai-responses' },
				baseUrl: 'https://api.openai.com/v1',
				auth: null,
				headers: [],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			messages: [{ role: 'user', content: 'Hello' }],
			tools: [{ name: 'propose-plan-output', description: 'Propose.', executionMode: 'exclusive', parameters: { type: 'object' } }],
			signal: new AbortController().signal,
			onDelta: () => undefined,
			access: { auth: null, headers: [] },
			...overrides,
		}
	}
}
