import OpenAI from 'openai'
import type {
	Response,
	ResponseFunctionToolCall,
	ResponseOutputItem,
	ResponseOutputMessage,
	ResponseReasoningItem,
	ResponseStreamEvent,
	ResponseUsage,
} from 'openai/resources/responses/responses'
import { v } from 'valleyed'

import { providerFailurePreflight } from './provider-failures'
import type {
	ModelAgentTurnOutput,
	ModelProviderProtocolAccess,
	ModelProviderProtocolProvider,
	ModelProviderProtocolProviderModelAgentTurnInput,
	ModelProviderProtocolProviderPreflightModelInput,
} from './types'
import type {
	AgentRunModelContent,
	AgentRunModelCost,
	AgentRunModelMessage,
	AgentRunModelMessageOutcome,
	AgentRunModelUsage,
} from '../../domain/agent-run'
import type { ModelTokenPricing } from '../../domain/model'
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
	max_output_tokens: number
	reasoning?: { effort: string }
	tools?: unknown[]
}

type OpenAIResponsesWithResponse = {
	data: AsyncIterable<OpenAIResponsesStreamEvent>
	response: { status: number; headers?: unknown }
}

type OpenAIResponsesStreamEvent = ResponseStreamEvent

type OpenAIResponsesOutputItem = ResponseOutputItem

type OpenAIResponsesReasoningItem = ResponseReasoningItem

type OpenAIResponsesMessageItem = ResponseOutputMessage

type OpenAIResponsesFunctionCallItem = ResponseFunctionToolCall

type OpenAIResponsesTerminalResponse = Response

type OpenAIResponsesUsage = ResponseUsage

type OpenAIResponsesMessageContent = OpenAIResponsesMessageItem['content'][number]

type OpenAIResponsesReasoningSummaryPart = Extract<OpenAIResponsesStreamEvent, { type: 'response.reasoning_summary_part.added' }>['part']

type OpenAIResponsesReasoningTextPart =
	| OpenAIResponsesReasoningItem['summary'][number]
	| NonNullable<OpenAIResponsesReasoningItem['content']>[number]

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
		max_output_tokens: input.model.capabilities.maxOutputTokens,
		...(input.thinking === null ? {} : { reasoning: { effort: input.thinking.providerValue } }),
		...(tools === undefined ? {} : { tools }),
	}
}

function openAIResponsesMessage(message: AgentRunProviderMessage): unknown {
	const inputText = { type: 'input_text', text: message.content }
	switch (message.role) {
		case 'system':
			return { role: 'system', content: message.content }
		case 'user':
			return { role: 'user', content: [inputText] }
		case 'tool':
			return { role: 'user', content: [{ type: 'input_text', text: `Tool result:\n${message.content}` }] }
		case 'assistant':
			return { type: 'message', role: 'assistant', content: [outputText(message.content)], status: 'completed' }
		default:
			throw new Error(`Unexpected Agent Run provider message role: ${String(message.role satisfies never)}`)
	}
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
	switch (event.type) {
		case 'response.created':
			state.providerResponseRef = event.response.id ?? state.providerResponseRef
			return
		case 'response.queued':
		case 'response.in_progress':
		case 'response.content_part.added':
		case 'response.content_part.done':
		case 'response.output_text.done':
		case 'response.reasoning_summary_text.done':
		case 'response.reasoning_text.done':
		case 'response.refusal.done':
			return
		case 'response.output_item.added':
			startOutputItem(event.item, state, input)
			return
		case 'response.output_item.done':
			finishOutputItem(event.item, state, input)
			return
		case 'response.reasoning_summary_part.added':
			addReasoningSummaryPart(state, event.part)
			return
		case 'response.reasoning_summary_text.delta':
		case 'response.reasoning_text.delta':
			appendThinkingDelta(state, input, event.delta)
			return
		case 'response.reasoning_summary_part.done':
			appendThinkingDelta(state, input, '\n\n')
			return
		case 'response.output_text.delta':
		case 'response.refusal.delta':
			appendTextDelta(state, input, event.delta)
			return
		case 'response.function_call_arguments.delta':
			appendToolCallDelta(state, input, event.delta)
			return
		case 'response.function_call_arguments.done':
			finishToolCallArguments(state, input, event.arguments)
			return
		case 'response.completed':
			finishTerminalResponse(state, event.response, 'completed', input)
			return
		case 'response.incomplete':
			finishTerminalResponse(state, event.response, 'incomplete', input)
			return
		case 'response.failed':
			finishTerminalResponse(state, event.response, 'failed', input)
			throw new Error(responseFailedSummary(event.response))
		case 'error':
			throw new Error(event.message ?? event.code ?? 'OpenAI Responses stream error.')
		case 'response.audio.delta':
		case 'response.audio.done':
		case 'response.audio.transcript.delta':
		case 'response.audio.transcript.done':
		case 'response.code_interpreter_call_code.delta':
		case 'response.code_interpreter_call_code.done':
		case 'response.code_interpreter_call.completed':
		case 'response.code_interpreter_call.in_progress':
		case 'response.code_interpreter_call.interpreting':
		case 'response.custom_tool_call_input.delta':
		case 'response.custom_tool_call_input.done':
		case 'response.file_search_call.completed':
		case 'response.file_search_call.in_progress':
		case 'response.file_search_call.searching':
		case 'response.image_generation_call.completed':
		case 'response.image_generation_call.generating':
		case 'response.image_generation_call.in_progress':
		case 'response.image_generation_call.partial_image':
		case 'response.mcp_call_arguments.delta':
		case 'response.mcp_call_arguments.done':
		case 'response.mcp_call.completed':
		case 'response.mcp_call.failed':
		case 'response.mcp_call.in_progress':
		case 'response.mcp_list_tools.completed':
		case 'response.mcp_list_tools.failed':
		case 'response.mcp_list_tools.in_progress':
		case 'response.output_text.annotation.added':
		case 'response.web_search_call.completed':
		case 'response.web_search_call.in_progress':
		case 'response.web_search_call.searching':
			throw unsupportedOpenAIResponsesStreamEvent(event.type)
		default:
			throw new Error(`Unexpected OpenAI Responses stream event: ${String(event satisfies never)}`)
	}
}

function startOutputItem(item: OpenAIResponsesOutputItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	switch (item.type) {
		case 'reasoning':
			startThinkingItem(item, state, input)
			return
		case 'message':
			startTextItem(state, input)
			return
		case 'function_call':
			startToolCallItem(item, state, input)
			return
		case 'additional_tools':
		case 'apply_patch_call':
		case 'apply_patch_call_output':
		case 'code_interpreter_call':
		case 'compaction':
		case 'computer_call':
		case 'computer_call_output':
		case 'custom_tool_call':
		case 'custom_tool_call_output':
		case 'file_search_call':
		case 'function_call_output':
		case 'image_generation_call':
		case 'local_shell_call':
		case 'local_shell_call_output':
		case 'mcp_approval_request':
		case 'mcp_approval_response':
		case 'mcp_call':
		case 'mcp_list_tools':
		case 'shell_call':
		case 'shell_call_output':
		case 'tool_search_call':
		case 'tool_search_output':
		case 'web_search_call':
			throw unsupportedOpenAIResponsesOutputItem(item.type)
		default:
			throw new Error(`Unexpected OpenAI Responses output item type: ${String(item satisfies never)}`)
	}
}

function finishOutputItem(item: OpenAIResponsesOutputItem, state: StreamState, input: OpenAIResponsesTurnInput): void {
	switch (item.type) {
		case 'reasoning':
			finishThinkingItem(item, state, input)
			return
		case 'message':
			finishTextItem(item, state, input)
			return
		case 'function_call':
			finishToolCallItem(item, state, input)
			return
		case 'additional_tools':
		case 'apply_patch_call':
		case 'apply_patch_call_output':
		case 'code_interpreter_call':
		case 'compaction':
		case 'computer_call':
		case 'computer_call_output':
		case 'custom_tool_call':
		case 'custom_tool_call_output':
		case 'file_search_call':
		case 'function_call_output':
		case 'image_generation_call':
		case 'local_shell_call':
		case 'local_shell_call_output':
		case 'mcp_approval_request':
		case 'mcp_approval_response':
		case 'mcp_call':
		case 'mcp_list_tools':
		case 'shell_call':
		case 'shell_call_output':
		case 'tool_search_call':
		case 'tool_search_output':
		case 'web_search_call':
			throw unsupportedOpenAIResponsesOutputItem(item.type)
		default:
			throw new Error(`Unexpected OpenAI Responses output item type: ${String(item satisfies never)}`)
	}
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

function addReasoningSummaryPart(state: StreamState, part: OpenAIResponsesReasoningSummaryPart): void {
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

function finishTerminalResponse(
	state: StreamState,
	response: OpenAIResponsesTerminalResponse,
	fallback: TerminalStatus,
	input: OpenAIResponsesTurnInput,
): void {
	state.providerResponseRef = response.id ?? state.providerResponseRef
	state.usage = usageFromOpenAIResponse(response.usage, input.model.pricing)
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

function usageFromOpenAIResponse(usage: OpenAIResponsesUsage | undefined, pricing: ModelTokenPricing | null): AgentRunModelUsage | null {
	return usage === undefined ? null : usageFromPresentOpenAIResponse(usage, pricing)
}

function usageFromPresentOpenAIResponse(usage: OpenAIResponsesUsage, pricing: ModelTokenPricing | null): AgentRunModelUsage {
	const tokenUsage = {
		inputTokens: inputTokens(usage),
		outputTokens: outputTokens(usage),
		cacheReadTokens: cacheReadTokens(usage),
		cacheWriteTokens: 0,
		totalTokens: totalTokens(usage),
	}
	return { ...tokenUsage, cost: pricing === null ? null : costFromUsage(tokenUsage, pricing) }
}

function costFromUsage(
	usage: Pick<AgentRunModelUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
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
	if (status === undefined) return null
	switch (status) {
		case 'completed':
		case 'in_progress':
		case 'queued':
			return 'completed'
		case 'incomplete':
			return 'incomplete'
		case 'failed':
		case 'cancelled':
			return 'failed'
		default:
			throw new Error(`Unexpected OpenAI Responses terminal status: ${String(status satisfies never)}`)
	}
}

function responseFailedSummary(response: OpenAIResponsesTerminalResponse): string {
	return response.error === null ? responseIncompleteSummary(response) : responseErrorSummary(response.error)
}

function responseErrorSummary(error: NonNullable<OpenAIResponsesTerminalResponse['error']>): string {
	return `${error.code ?? 'unknown'}: ${error.message ?? 'no message'}`
}

function responseIncompleteSummary(response: OpenAIResponsesTerminalResponse): string {
	return response.incomplete_details?.reason === undefined
		? 'OpenAI Responses request failed.'
		: `incomplete: ${response.incomplete_details.reason}`
}

function unsupportedOpenAIResponsesStreamEvent(type: string): Error {
	return new Error(`Unsupported OpenAI Responses stream event: ${type}`)
}

function unsupportedOpenAIResponsesOutputItem(type: string): Error {
	return new Error(`Unsupported OpenAI Responses output item: ${type}`)
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
						{ type: 'response.created', response: response({ id: 'resp-1' }), sequence_number: 1 },
						{ type: 'response.output_item.added', item: outputMessage('msg-1', []), output_index: 0, sequence_number: 2 },
						{
							type: 'response.content_part.added',
							part: { type: 'output_text', text: '', annotations: [] },
							content_index: 0,
							item_id: 'msg-1',
							output_index: 0,
							sequence_number: 3,
						},
						{
							type: 'response.output_text.delta',
							delta: 'Hello',
							content_index: 0,
							item_id: 'msg-1',
							logprobs: [],
							output_index: 0,
							sequence_number: 4,
						},
						{
							type: 'response.output_item.done',
							item: outputMessage('msg-1', [{ type: 'output_text', text: 'Hello', annotations: [] }]),
							output_index: 0,
							sequence_number: 5,
						},
						{
							type: 'response.completed',
							response: response({ id: 'resp-1', status: 'completed', usage: usage(12, 3, 15, 2) }),
							sequence_number: 6,
						},
					])
				}),
			)

			const result = await provider.runModelAgentTurn!(turnInput({ onDelta: (delta) => deltas.push(delta) }))

			expect(request).toMatchObject({ model: 'gpt-5', stream: true, store: false, max_output_tokens: 16384 })
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

		it('passes configured thinking provider values', async () => {
			let request: OpenAIResponsesRequest | null = null
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client((params) => {
					request = params
					return withResponse([
						{ type: 'response.completed', response: response({ id: 'resp-1', status: 'completed' }), sequence_number: 1 },
					])
				}),
			)

			const result = await provider.runModelAgentTurn!(turnInput({ thinking: { level: 'high', providerValue: 'high' } }))

			expect(request).toMatchObject({ reasoning: { effort: 'high' } })
			expect(result.outcome.type).toBe('stop')
		})

		it('streams function calls into a tool-use outcome', async () => {
			const deltas: unknown[] = []
			const toolInput = {
				proposedDeliveries: {},
				proposedMemoryCreations: { memory: { parentId: null, title: 'Memory', body: '', children: {} } },
				proposedMemoryRevisions: {},
			}
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client(() =>
					withResponse([
						{
							type: 'response.output_item.added',
							item: functionCallItem(''),
							output_index: 0,
							sequence_number: 1,
						},
						{
							type: 'response.function_call_arguments.delta',
							delta: '{"proposedDeliveries":{}',
							item_id: 'fc-1',
							output_index: 0,
							sequence_number: 2,
						},
						{
							type: 'response.function_call_arguments.delta',
							delta: ',"proposedMemoryCreations":{"memory":{"parentId":null,"title":"Memory","body":"","children":{}}},"proposedMemoryRevisions":{}}',
							item_id: 'fc-1',
							output_index: 0,
							sequence_number: 3,
						},
						{
							type: 'response.function_call_arguments.done',
							arguments: JSON.stringify(toolInput),
							item_id: 'fc-1',
							name: 'propose-plan-output',
							output_index: 0,
							sequence_number: 4,
						},
						{
							type: 'response.output_item.done',
							item: functionCallItem(JSON.stringify(toolInput)),
							output_index: 0,
							sequence_number: 5,
						},
						{ type: 'response.completed', response: response({ id: 'resp-1', status: 'completed' }), sequence_number: 6 },
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

		it('computes integer micro-USD costs when pricing is configured', async () => {
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client(() =>
					withResponse([
						{
							type: 'response.completed',
							response: response({ id: 'resp-1', status: 'completed', usage: usage(10, 3, 13, 2) }),
							sequence_number: 1,
						},
					]),
				),
			)

			const result = await provider.runModelAgentTurn!(
				turnInput({
					model: {
						...turnInput().model,
						pricing: {
							unit: 'micro-usd-per-million-tokens',
							input: 2_000_000,
							output: 8_000_000,
							cacheRead: 500_000,
							cacheWrite: 0,
						},
					},
				}),
			)

			expect(result.outcome).toMatchObject({
				message: { usage: { cost: { unit: 'micro-usd', input: 16, output: 24, cacheRead: 1, cacheWrite: 0, total: 41 } } },
			})
		})

		it('preserves reasoning replay metadata', async () => {
			const reasoningItem: OpenAIResponsesReasoningItem = {
				type: 'reasoning',
				id: 'rs-1',
				summary: [{ text: 'Think', type: 'summary_text' }],
			}
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() =>
				client(() =>
					withResponse([
						{
							type: 'response.output_item.added',
							item: { type: 'reasoning', id: 'rs-1', summary: [] },
							output_index: 0,
							sequence_number: 1,
						},
						{
							type: 'response.reasoning_summary_part.added',
							part: { text: '', type: 'summary_text' },
							item_id: 'rs-1',
							output_index: 0,
							sequence_number: 2,
							summary_index: 0,
						},
						{
							type: 'response.reasoning_summary_text.delta',
							delta: 'Think',
							item_id: 'rs-1',
							output_index: 0,
							sequence_number: 3,
							summary_index: 0,
						},
						{ type: 'response.output_item.done', item: reasoningItem, output_index: 0, sequence_number: 4 },
						{ type: 'response.completed', response: response({ id: 'resp-1', status: 'completed' }), sequence_number: 5 },
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

	function response(overrides: Partial<OpenAIResponsesTerminalResponse> = {}): OpenAIResponsesTerminalResponse {
		return {
			id: 'resp-1',
			created_at: 0,
			output_text: '',
			error: null,
			incomplete_details: null,
			instructions: null,
			metadata: null,
			model: 'gpt-5',
			object: 'response',
			output: [],
			parallel_tool_calls: false,
			temperature: null,
			tool_choice: 'auto',
			tools: [],
			top_p: null,
			...overrides,
		}
	}

	function usage(inputTokens: number, outputTokens: number, totalTokens: number, cachedTokens: number): OpenAIResponsesUsage {
		return {
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			total_tokens: totalTokens,
			input_tokens_details: { cached_tokens: cachedTokens },
			output_tokens_details: { reasoning_tokens: 0 },
		}
	}

	function outputMessage(id: string, content: OpenAIResponsesMessageItem['content']): OpenAIResponsesMessageItem {
		return { type: 'message', id, role: 'assistant', status: 'completed', content }
	}

	function functionCallItem(args: string): OpenAIResponsesFunctionCallItem {
		return { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'propose-plan-output', arguments: args }
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
			thinking: null,
			onDelta: () => undefined,
			access: { auth: null, headers: [] },
			...overrides,
		}
	}
}
