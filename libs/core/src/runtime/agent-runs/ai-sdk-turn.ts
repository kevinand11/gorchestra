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
import type { AgentRunEvent } from '../../domain/agent-run'
import type { ModelThinkingLevel } from '../../domain/model'
import { providerFailureReason } from '../../providers/model-provider-protocol/provider-failures'
import type { Result } from '../../utils/types'

type AISDKTurnOutput = {
	turnOutcome: Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome']
}

const maxModelStepsPerTurn = 5

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

function turnFailureOutcome(
	error: unknown,
	signal: AbortSignal | undefined,
): Extract<AgentRunEvent['body'], { type: 'turn-ended' }>['outcome'] {
	if (signal?.aborted === true) return { type: 'error', reason: { type: 'abort-signal' } }
	return { type: 'error', reason: providerFailureReason(error) }
}
