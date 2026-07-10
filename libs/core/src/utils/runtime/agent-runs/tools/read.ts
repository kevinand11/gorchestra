import { TextDecoder } from 'node:util'

import { v, type Pipe } from 'valleyed'

import { readRequiredWorkspaceFile } from './file-contents'
import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, failSandboxError, sandboxErrorSummary, toolOutput, type AgentRunToolExecutionFailed } from './results'
import { truncateReadText, toolOutputMaxBytes } from './truncation'
import { nonEmptyTrimmedStringPipe, positiveIntegerPipe } from '../../../../domain/commons'
import type { ManagedSandbox } from '../../sandboxes/managed'
import type { CoreAgentRunToolContext } from '../types'

type ReadInput = { path: string; offset: number | undefined; limit: number | undefined }
const readInputPipe: Pipe<unknown, ReadInput> = v.object({
	path: nonEmptyTrimmedStringPipe,
	offset: v.optional(positiveIntegerPipe),
	limit: v.optional(positiveIntegerPipe),
})

export function readTool(): CoreAgentRunToolDefinition<ReadInput> {
	return {
		name: 'read',
		contractVersion: 1,
		description:
			'Read the contents of a file. Supports UTF-8 text files and images (jpg, png, gif, webp, bmp). Text output is truncated to 2000 lines or 50KB. Use offset/limit for large files.',
		inputPipe: readInputPipe,
		promptSnippet: 'Read file contents',
		promptGuidelines: ['Use read to examine files instead of shell commands for simple file inspection.'],
		workspaceMutationKind: 'read-only',
		execute: (input, context) => readWorkspaceFile(input, context),
	}
}

async function readWorkspaceFile(input: ReadInput, context: CoreAgentRunToolContext) {
	const path = resolvePathOrFail(input.path)
	const file = await readRequiredWorkspaceFile(context, path, 'read')
	const bytes = Buffer.from(file.contentsBase64, 'base64')
	const mimeType = supportedImageMimeType(bytes)
	if (mimeType !== null)
		return {
			output: { type: 'image' as const, mimeType, dataBase64: bytes.toString('base64'), note: `Read image file [${mimeType}].` },
			truncation: null,
		}

	const text = decodeUtf8OrFail(bytes, path)
	const redacted = await context.sandbox.redactText({ text })
	if (!redacted.ok) failSandboxError(sandboxErrorSummary(redacted.error))
	return readTextOutput(redacted.value, input)
}

function resolvePathOrFail(inputPath: string): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: false })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid read path.')
	return path.value
}

function decodeUtf8OrFail(bytes: Buffer, path: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		failInvalidInput(`Cannot read ${path} as UTF-8 text or a supported image.`)
	}
}

function readTextOutput(text: string, input: ReadInput) {
	const lines = text.split('\n')
	const startIndex = input.offset === undefined ? 0 : input.offset - 1
	if (startIndex >= lines.length) failInvalidInput(`Offset ${input.offset} is beyond end of file (${lines.length} lines total).`)

	const selectedLines = input.limit === undefined ? lines.slice(startIndex) : lines.slice(startIndex, startIndex + input.limit)
	const truncated = truncateReadText(selectedLines.join('\n'))
	const outputText = withReadContinuationNotice(truncated.content, {
		firstLineExceedsLimit: truncated.firstLineExceedsLimit,
		startLine: startIndex + 1,
		shownLines: truncated.outputLines,
		totalLines: lines.length,
		userLimit: input.limit,
		truncated: truncated.truncation !== null,
	})
	return { output: { type: 'text' as const, value: outputText }, truncation: truncated.truncation }
}

function withReadContinuationNotice(
	content: string,
	input: {
		firstLineExceedsLimit: boolean
		startLine: number
		shownLines: number
		totalLines: number
		userLimit: number | undefined
		truncated: boolean
	},
): string {
	if (input.firstLineExceedsLimit)
		return `[Line ${input.startLine} exceeds ${toolOutputMaxBytes / 1024}KB limit. Use offset=${input.startLine} with a smaller external inspection strategy.]`
	if (input.truncated) {
		const endLine = input.startLine + input.shownLines - 1
		return `${content}\n\n[Showing lines ${input.startLine}-${endLine} of ${input.totalLines}. Use offset=${endLine + 1} to continue.]`
	}
	if (input.userLimit !== undefined && input.startLine + input.userLimit - 1 < input.totalLines) {
		const nextOffset = input.startLine + input.userLimit
		return `${content}\n\n[${input.totalLines - nextOffset + 1} more lines in file. Use offset=${nextOffset} to continue.]`
	}
	return content
}

function supportedImageMimeType(bytes: Buffer): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
	if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
	if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
	if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
		return 'image/webp'
	return bytes.subarray(0, 2).toString('ascii') === 'BM' ? 'image/bmp' : null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('read tool', () => {
		it('reads redacted UTF-8 text with offset, limit, and continuation notice', async () => {
			const output = await readTool().execute(
				{ path: 'notes.txt', offset: 2, limit: 1 },
				toolContext({ '/workspace/notes.txt': 'alpha\nsecret\ngamma' }),
			)
			expect(output).toEqual(toolOutput('REDACTED\n\n[1 more lines in file. Use offset=3 to continue.]'))
		})

		it('truncates long text reads with evidence', async () => {
			const content = Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join('\n')
			const output = await readTool().execute(readInput('long.txt'), toolContext({ '/workspace/long.txt': content }))
			expect(output.output.type === 'text' && output.output.value).toContain(
				'[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]',
			)
			expect(output.truncation).toMatchObject({ truncated: true, strategy: 'head', originalLines: 2001, outputLines: 2000 })
		})

		it('returns supported images as image outputs', async () => {
			const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
			await expect(readTool().execute(readInput('image.png'), toolContext({ '/workspace/image.png': png }))).resolves.toEqual({
				output: { type: 'image', mimeType: 'image/png', dataBase64: png.toString('base64'), note: 'Read image file [image/png].' },
				truncation: null,
			})
		})

		it('rejects missing, directory, and binary paths as invalid input', async () => {
			await expect(readTool().execute(readInput('../secret'), toolContext({}))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
			await expect(readTool().execute(readInput('missing.txt'), toolContext({}))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
			await expect(readTool().execute(readInput('dir'), toolContext({ '/workspace/dir/file.txt': 'x' }))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
			await expect(
				readTool().execute(readInput('binary.dat'), toolContext({ '/workspace/binary.dat': Buffer.from([0xff]) })),
			).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			} satisfies Partial<AgentRunToolExecutionFailed>)
		})
	})

	function readInput(path: string): ReadInput {
		return { path, offset: undefined, limit: undefined }
	}

	function toolContext(files: Record<string, string | Buffer>): CoreAgentRunToolContext {
		return {
			agentRunId: '01k00000000000000000000002',
			assistantMessageEventId: '01k00000000000000000000003',
			toolCallId: 'call-1',
			signal: new AbortController().signal,
			onUpdate: () => {},
			recordProposal: () => Promise.resolve(toolOutput('proposal')),
			sandbox: fakeSandbox(files),
		}
	}

	function fakeSandbox(files: Record<string, string | Buffer>): ManagedSandbox {
		return {
			setEnv: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			runCommand: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			readFile: ({ path }) => Promise.resolve({ ok: true, value: fakeReadFile(files, path) }),
			writeFile: () => Promise.resolve({ ok: true, value: undefined }),
			listDirectory: () => Promise.resolve({ ok: true, value: null }),
			deletePath: () => Promise.resolve({ ok: true, value: undefined }),
			redactText: ({ text }) => Promise.resolve({ ok: true, value: text.split('secret').join('REDACTED') }),
			redactJson: ({ value }) => Promise.resolve({ ok: true, value }),
			release: () => Promise.resolve({ ok: true, value: { summary: 'released' } }),
		}
	}

	function fakeReadFile(files: Record<string, string | Buffer>, path: string) {
		const value = files[path]
		if (value !== undefined) return { type: 'file' as const, contentsBase64: Buffer.from(value).toString('base64') }
		return Object.keys(files).some((filePath) => filePath.startsWith(`${path}/`)) ? { type: 'directory' as const } : null
	}
}
