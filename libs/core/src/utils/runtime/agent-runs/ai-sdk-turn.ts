import {
	isStepCount,
	streamText,
	type JSONValue,
	type LanguageModel,
	type LanguageModelCallEndEvent,
	type ModelMessage,
	type TextStreamPart,
	type ToolSet,
} from 'ai'

import { AISDKTurnRecorder } from './ai-sdk-turn-recorder'
import type { TurnModelUse } from './turn-model-use'
import type {
	AgentRunLoopState,
	AgentRunRuntimeError,
	ModelAgentRunRuntime,
	ModelAgentTurnThinking,
	RunModelAgentRunOptions,
} from './types'
import type { AgentRunEvent } from '../../../domain/agent-run-event'
import type { ModelThinkingLevel } from '../../../domain/model'
import { providerFailureReason } from '../../providers/model-provider-protocol/provider-failures'
import type { Result } from '../../types'

type AISDKTurnOutput = {
	turnOutcome: Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome']
}

const maxModelStepsPerTurn = 25

export async function runAISDKTurn(
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
		const prompt = promptFromMessages(messages)
		const streamOptions = {
			model: resolution.languageModel,
			...(prompt.instructions === undefined ? {} : { instructions: prompt.instructions }),
			messages: prompt.messages,
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

function promptFromMessages(messages: ModelMessage[]): { instructions: string | undefined; messages: ModelMessage[] } {
	const instructionParts: string[] = []
	const modelMessages: ModelMessage[] = []

	for (const message of messages) {
		if (message.role === 'system') instructionParts.push(message.content)
		else modelMessages.push(message)
	}

	return { instructions: instructionParts.length === 0 ? undefined : instructionParts.join('\n\n'), messages: modelMessages }
}

function aiSdkReasoningForThinking(thinking: ModelAgentTurnThinking): ModelThinkingLevel | undefined {
	return thinking?.level
}

function turnFailureOutcome(
	error: unknown,
	signal: AbortSignal | undefined,
): Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome'] {
	if (signal?.aborted === true) return { type: 'error', reason: { type: 'abort-signal' } }
	return { type: 'error', reason: providerFailureReason(error) }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AI SDK turn prompt projection', () => {
		it('moves system messages into instructions while preserving other message roles', () => {
			const prompt = promptFromMessages([
				{ role: 'system', content: 'base instructions' },
				{ role: 'user', content: 'hello' },
				{ role: 'system', content: 'compacted summary' },
				{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
			])

			expect(prompt).toEqual({
				instructions: 'base instructions\n\ncompacted summary',
				messages: [
					{ role: 'user', content: 'hello' },
					{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
				],
			})
		})

		it('omits instructions when the context has no system messages', () => {
			const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]

			expect(promptFromMessages(messages)).toEqual({ instructions: undefined, messages })
		})
	})
}
