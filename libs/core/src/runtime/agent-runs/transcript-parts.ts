import type { ContentPart, ToolSet } from 'ai'

import type { TurnModelUse } from './turn-model-use'
import type { AgentRunAssistantTranscriptPart, AgentRunEvent, AgentRunToolResultOutput } from '../../domain/agent-run'
import { modelProviderProtocolForSource } from '../../domain/model-provider'

export function assistantMessageModel(turnModelUse: TurnModelUse): Extract<AgentRunEvent['body'], { type: 'assistant-message' }>['model'] {
	return {
		modelId: turnModelUse.model.id,
		thinkingLevel: turnModelUse.thinking?.level ?? 'none',
		modelProviderId: turnModelUse.modelProvider.id,
		providerProtocol: modelProviderProtocolForSource(turnModelUse.modelProvider.source),
		providerModelId: turnModelUse.model.providerModelId,
	}
}

export function assistantPartsFromAIContent(content: ReadonlyArray<ContentPart<ToolSet>>): AgentRunAssistantTranscriptPart[] {
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

export function toAISDKToolOutput(output: AgentRunToolResultOutput): unknown {
	return output.type === 'execution-denied' && output.reason === null ? { type: output.type } : output
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
