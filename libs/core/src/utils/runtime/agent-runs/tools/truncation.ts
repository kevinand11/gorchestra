import type { AgentRunToolTruncation } from '../../../../domain/agent-run-event'

export const textReadMaxLines = 2000
export const toolOutputMaxBytes = 50 * 1024
export const listMaxEntries = 500
export const grepMaxLineLength = 500

export interface TruncatedText {
	content: string
	truncation: AgentRunToolTruncation | null
	firstLineExceedsLimit: boolean
	totalLines: number
	outputLines: number
}

export function truncateReadText(content: string): TruncatedText {
	return truncateHead(content, { maxLines: textReadMaxLines, maxBytes: toolOutputMaxBytes })
}

export function truncateSearchText(content: string): TruncatedText {
	return truncateHead(content, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: toolOutputMaxBytes })
}

export function truncateCommandText(content: string): TruncatedText {
	return truncateTail(content, { maxLines: textReadMaxLines, maxBytes: toolOutputMaxBytes })
}

export function truncateLine(line: string): { text: string; truncated: boolean } {
	return line.length <= grepMaxLineLength
		? { text: line, truncated: false }
		: { text: `${line.slice(0, grepMaxLineLength)}... [truncated]`, truncated: true }
}

export function lineCount(content: string): number {
	return splitLinesForCounting(content).length
}

export function resultLimitTruncation(totalResults: number, outputResults: number, output: string): AgentRunToolTruncation | null {
	return totalResults < outputResults
		? null
		: {
				truncated: true,
				strategy: 'result-limit',
				originalBytes: null,
				originalLines: totalResults,
				outputBytes: Buffer.byteLength(output, 'utf8'),
				outputLines: outputResults,
			}
}

function truncateHead(content: string, limits: { maxLines: number; maxBytes: number }): TruncatedText {
	return truncateFromLines(content, limits, 'head')
}

function truncateTail(content: string, limits: { maxLines: number; maxBytes: number }): TruncatedText {
	const totalBytes = Buffer.byteLength(content, 'utf8')
	const lines = splitLinesForCounting(content)
	if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes) return untruncated(content, lines.length)

	const outputLines: string[] = []
	let outputBytes = 0
	for (let index = lines.length - 1; index >= 0 && outputLines.length < limits.maxLines; index -= 1) {
		const line = lines[index]!
		const lineBytes = Buffer.byteLength(line, 'utf8') + (outputLines.length > 0 ? 1 : 0)
		if (outputBytes + lineBytes > limits.maxBytes) break
		outputLines.unshift(line)
		outputBytes += lineBytes
	}
	const output = outputLines.join('\n')
	return truncated(output, 'tail', lines.length, totalBytes, outputLines.length, Buffer.byteLength(output, 'utf8'), false)
}

function truncateFromLines(content: string, limits: { maxLines: number; maxBytes: number }, strategy: 'head'): TruncatedText {
	const totalBytes = Buffer.byteLength(content, 'utf8')
	const lines = splitLinesForCounting(content)
	if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes) return untruncated(content, lines.length)

	const firstLine = lines[0] ?? ''
	if (Buffer.byteLength(firstLine, 'utf8') > limits.maxBytes) {
		return truncated('', strategy, lines.length, totalBytes, 0, 0, true)
	}

	const outputLines: string[] = []
	let outputBytes = 0
	for (const line of lines.slice(0, limits.maxLines)) {
		const lineBytes = Buffer.byteLength(line, 'utf8') + (outputLines.length > 0 ? 1 : 0)
		if (outputBytes + lineBytes > limits.maxBytes) break
		outputLines.push(line)
		outputBytes += lineBytes
	}
	const output = outputLines.join('\n')
	return truncated(output, strategy, lines.length, totalBytes, outputLines.length, Buffer.byteLength(output, 'utf8'), false)
}

function untruncated(content: string, totalLines: number): TruncatedText {
	return { content, truncation: null, firstLineExceedsLimit: false, totalLines, outputLines: totalLines }
}

function truncated(
	content: string,
	strategy: AgentRunToolTruncation['strategy'],
	originalLines: number,
	originalBytes: number,
	outputLines: number,
	outputBytes: number,
	firstLineExceedsLimit: boolean,
): TruncatedText {
	return {
		content,
		firstLineExceedsLimit,
		totalLines: originalLines,
		outputLines,
		truncation: { truncated: true, strategy, originalBytes, originalLines, outputBytes, outputLines },
	}
}

function splitLinesForCounting(content: string): string[] {
	if (content.length === 0) return []
	const lines = content.split('\n')
	if (content.endsWith('\n')) lines.pop()
	return lines
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('tool truncation helpers', () => {
		it('keeps read output from the head and records truncation evidence', () => {
			const output = truncateReadText(Array.from({ length: textReadMaxLines + 1 }, (_, index) => `line ${index + 1}`).join('\n'))
			expect(output.outputLines).toBe(textReadMaxLines)
			expect(output.content.endsWith(`line ${textReadMaxLines}`)).toBe(true)
			expect(output.truncation).toMatchObject({ truncated: true, strategy: 'head', originalLines: textReadMaxLines + 1 })
		})

		it('keeps command output from the tail and truncates long grep lines', () => {
			const output = truncateCommandText(Array.from({ length: textReadMaxLines + 1 }, (_, index) => `line ${index + 1}`).join('\n'))
			expect(output.content.startsWith('line 2\n')).toBe(true)
			expect(output.truncation).toMatchObject({ truncated: true, strategy: 'tail' })
			expect(truncateLine('x'.repeat(grepMaxLineLength + 1))).toEqual({
				text: `${'x'.repeat(grepMaxLineLength)}... [truncated]`,
				truncated: true,
			})
		})
	})
}
