import type { ContentPart, ToolSet } from 'ai'

import type { TurnModelUse } from './turn-model-use'
import type { AgentRunAssistantTranscriptPart, AgentRunEvent, AgentRunToolResultOutput } from '../../../domain/agent-run-event'
import { modelProviderProtocolForSource } from '../../../domain/model-provider'

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
	return isRecord(output) ? normalizeRecordToolResultOutput(output) : { type: 'json', value: output }
}

function normalizeRecordToolResultOutput(output: Record<string, unknown>): AgentRunToolResultOutput {
	switch (output.type) {
		case 'text':
			return { type: 'text', value: stringValue(output.value) }
		case 'error-text':
			return { type: 'error-text', value: stringValue(output.value) }
		case 'execution-denied':
			return { type: 'execution-denied', reason: typeof output.reason === 'string' ? output.reason : null }
		case 'json':
			return { type: 'json', value: output.value }
		case 'command':
			return normalizeCommandOutput(output)
		case 'image':
			return normalizeImageOutput(output)
		case 'diff':
			return normalizeDiffOutput(output)
		default:
			return { type: 'json', value: output }
	}
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

export function toAISDKToolOutput(output: AgentRunToolResultOutput): unknown {
	switch (output.type) {
		case 'execution-denied':
			return output.reason === null ? { type: output.type } : output
		case 'command':
			return { type: 'text', value: commandOutputText(output) }
		case 'image':
			return imageToolOutput(output)
		case 'diff':
			return { type: 'text', value: diffOutputText(output) }
		case 'text':
		case 'json':
		case 'error-text':
			return output
		default:
			throw new Error(`Unexpected Agent Run Tool output type: ${String(output satisfies never)}`)
	}
}

function normalizeCommandOutput(output: Record<string, unknown>): AgentRunToolResultOutput {
	return {
		type: 'command',
		exitCode: typeof output.exitCode === 'number' && Number.isInteger(output.exitCode) && output.exitCode >= 0 ? output.exitCode : 0,
		stdout: typeof output.stdout === 'string' ? output.stdout : null,
		stderr: typeof output.stderr === 'string' ? output.stderr : null,
		stdoutTruncation: null,
		stderrTruncation: null,
	}
}

function normalizeImageOutput(output: Record<string, unknown>): AgentRunToolResultOutput {
	return {
		type: 'image',
		mimeType: typeof output.mimeType === 'string' && output.mimeType.length > 0 ? output.mimeType : 'application/octet-stream',
		dataBase64: typeof output.dataBase64 === 'string' ? output.dataBase64 : '',
		note: typeof output.note === 'string' ? output.note : null,
	}
}

function normalizeDiffOutput(output: Record<string, unknown>): AgentRunToolResultOutput {
	return {
		type: 'diff',
		summary: typeof output.summary === 'string' ? output.summary : 'Diff produced.',
		diff: typeof output.diff === 'string' ? output.diff : '',
		patch: typeof output.patch === 'string' ? output.patch : null,
	}
}

function commandOutputText(output: Extract<AgentRunToolResultOutput, { type: 'command' }>): string {
	return [
		`Exit code: ${output.exitCode}`,
		commandStreamSection('stdout', output.stdout, output.stdoutTruncation),
		commandStreamSection('stderr', output.stderr, output.stderrTruncation),
	].join('\n\n')
}

function commandStreamSection(
	label: 'stdout' | 'stderr',
	text: string | null,
	truncation: Extract<AgentRunToolResultOutput, { type: 'command' }>['stdoutTruncation'],
): string {
	const body = text === null || text.length === 0 ? '(empty)' : text
	return truncation === null || !truncation.truncated ? `${label}:\n${body}` : `${label}:\n${truncationNotice(truncation)}\n\n${body}`
}

function imageToolOutput(output: Extract<AgentRunToolResultOutput, { type: 'image' }>): unknown {
	return {
		type: 'content',
		value: [
			...(output.note === null ? [] : [{ type: 'text' as const, text: output.note }]),
			{ type: 'file' as const, data: { type: 'data' as const, data: output.dataBase64 }, mediaType: output.mimeType },
		],
	}
}

function diffOutputText(output: Extract<AgentRunToolResultOutput, { type: 'diff' }>): string {
	return [output.summary, `Diff:\n${output.diff}`, ...(output.patch === null ? [] : [`Patch:\n${output.patch}`])].join('\n\n')
}

function truncationNotice(truncation: NonNullable<Extract<AgentRunToolResultOutput, { type: 'command' }>['stdoutTruncation']>): string {
	const original = truncation.originalLines === null ? 'unknown original line count' : `${truncation.originalLines} original lines`
	const shown = truncation.outputLines === null ? 'stored output' : `${truncation.outputLines} stored lines`
	return `[Tool output truncated using ${truncation.strategy}: ${shown} from ${original}.]`
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

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Agent Run transcript part projection', () => {
		it('projects command output as labeled text with per-stream truncation notices', () => {
			expect(
				toAISDKToolOutput({
					type: 'command',
					exitCode: 2,
					stdout: 'visible stdout',
					stderr: 'visible stderr',
					stdoutTruncation: {
						truncated: true,
						strategy: 'tail',
						originalBytes: null,
						originalLines: 20,
						outputBytes: null,
						outputLines: 5,
					},
					stderrTruncation: null,
				}),
			).toEqual({
				type: 'text',
				value: 'Exit code: 2\n\nstdout:\n[Tool output truncated using tail: 5 stored lines from 20 original lines.]\n\nvisible stdout\n\nstderr:\nvisible stderr',
			})
		})

		it('projects image output as content with a file part', () => {
			expect(toAISDKToolOutput({ type: 'image', mimeType: 'image/png', dataBase64: 'aW1hZ2U=', note: 'Rendered preview.' })).toEqual({
				type: 'content',
				value: [
					{ type: 'text', text: 'Rendered preview.' },
					{ type: 'file', data: { type: 'data', data: 'aW1hZ2U=' }, mediaType: 'image/png' },
				],
			})
		})

		it('projects diff output as summary plus diff and patch text', () => {
			expect(toAISDKToolOutput({ type: 'diff', summary: 'Updated file.', diff: '- old\n+ new', patch: 'patch body' })).toEqual({
				type: 'text',
				value: 'Updated file.\n\nDiff:\n- old\n+ new\n\nPatch:\npatch body',
			})
		})
	})
}
