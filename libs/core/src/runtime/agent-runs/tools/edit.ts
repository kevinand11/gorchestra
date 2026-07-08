import { TextDecoder } from 'node:util'

import { v, type Pipe } from 'valleyed'

import { readRequiredWorkspaceFile } from './file-contents'
import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, failSandboxError, sandboxErrorSummary, toolOutput } from './results'
import { nonEmptyTrimmedStringPipe } from '../../../domain/commons'
import type { ManagedSandbox } from '../../sandboxes/managed'
import type { CoreAgentRunToolContext } from '../types'

type EditReplacement = { oldText: string; newText: string }
type EditInput = { path: string; edits: EditReplacement[] }
const editReplacementPipe: Pipe<unknown, EditReplacement> = v.object({ oldText: v.string(), newText: v.string() })
const editInputPipe: Pipe<unknown, EditInput> = v.object({
	path: nonEmptyTrimmedStringPipe,
	edits: v.array(editReplacementPipe).pipe(v.min(1)),
})

type MatchedEdit = { index: number; start: number; end: number; newText: string }

export function editTool(): CoreAgentRunToolDefinition<EditInput> {
	return {
		name: 'edit',
		contractVersion: 1,
		description:
			'Edit a single UTF-8 text file using exact text replacement. Every oldText must match a unique, non-overlapping region of the original file. The operation is atomic: if any edit is invalid, no write occurs.',
		inputPipe: editInputPipe,
		promptSnippet: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
		promptGuidelines: [
			'Use edit for precise changes; oldText must match exactly after normalizing line endings.',
			'When changing multiple separate locations in one file, use one edit call with multiple entries instead of multiple edit calls.',
			'Every edit is matched against the original file, not after earlier edits are applied. Do not emit overlapping replacements.',
			'Keep oldText as small as possible while still being unique.',
		],
		workspaceMutationKind: 'file-mutator',
		workspaceMutationKey: (input) => resolveWorkspaceToolPath(input.path, { defaultPath: '/workspace', allowWorkspaceRoot: false }),
		execute: (input, context) => editWorkspaceFile(input, context),
	}
}

async function editWorkspaceFile(input: EditInput, context: CoreAgentRunToolContext) {
	const path = resolvePathOrFail(input.path)
	const file = await readRequiredWorkspaceFile(context, path, 'edit')
	const original = decodeUtf8OrFail(Buffer.from(file.contentsBase64, 'base64'), path)
	const { bom, text } = stripBom(original)
	const lineEnding = detectLineEnding(text)
	const normalized = normalizeToLF(text)
	const next = applyExactEdits(normalized, input.edits, path)
	const finalText = `${bom}${restoreLineEndings(next, lineEnding)}`
	const write = await context.sandbox.writeFile({ path, contentsBase64: Buffer.from(finalText, 'utf8').toString('base64') })
	if (!write.ok) failSandboxError(sandboxErrorSummary(write.error))

	const diff = await redactOrFail(context, simpleDiff(path, normalized, next))
	const patch = await redactOrFail(context, simplePatch(path, normalized, next))
	return {
		output: { type: 'diff' as const, summary: `Successfully replaced ${input.edits.length} block(s) in ${path}.`, diff, patch },
		truncation: null,
	}
}

function resolvePathOrFail(inputPath: string): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: false })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid edit path.')
	return path.value
}

function decodeUtf8OrFail(bytes: Buffer, path: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		failInvalidInput(`Cannot edit non-UTF-8 file: ${path}.`)
	}
}

function applyExactEdits(content: string, edits: EditReplacement[], path: string): string {
	const normalizedEdits = edits.map((edit) => ({ oldText: normalizeToLF(edit.oldText), newText: normalizeToLF(edit.newText) }))
	validateEditInputs(normalizedEdits, path)
	const matches = normalizedEdits.map((edit, index) => uniqueMatch(content, edit.oldText, index, path, edits.length))
	assertNoOverlap(matches, path)
	const next = applyMatches(
		content,
		matches.map((match, index) => ({ ...match, newText: normalizedEdits[index]!.newText })),
	)
	if (next === content) failInvalidInput(`No changes made to ${path}.`)
	return next
}

function validateEditInputs(edits: { oldText: string; newText: string }[], path: string): void {
	const oldTexts = new Set<string>()
	for (const [index, edit] of edits.entries()) {
		if (edit.oldText.length === 0) failInvalidInput(`edits[${index}].oldText must not be empty in ${path}.`)
		if (edit.oldText === edit.newText) failInvalidInput(`edits[${index}] makes no change in ${path}.`)
		if (oldTexts.has(edit.oldText)) failInvalidInput(`Duplicate oldText in edits[${index}] for ${path}.`)
		oldTexts.add(edit.oldText)
	}
}

function uniqueMatch(content: string, oldText: string, index: number, path: string, totalEdits: number): MatchedEdit {
	const starts = matchStarts(content, oldText)
	if (starts.length === 0)
		failInvalidInput(totalEdits === 1 ? `Could not find the exact text in ${path}.` : `Could not find edits[${index}] in ${path}.`)
	if (starts.length > 1)
		failInvalidInput(
			totalEdits === 1
				? `Found ${starts.length} occurrences of the text in ${path}.`
				: `Found ${starts.length} occurrences of edits[${index}] in ${path}.`,
		)
	return { index, start: starts[0]!, end: starts[0]! + oldText.length, newText: '' }
}

function matchStarts(content: string, oldText: string): number[] {
	const starts: number[] = []
	let cursor = content.indexOf(oldText)
	while (cursor !== -1) {
		starts.push(cursor)
		cursor = content.indexOf(oldText, cursor + oldText.length)
	}
	return starts
}

function assertNoOverlap(matches: MatchedEdit[], path: string): void {
	const sorted = [...matches].sort((left, right) => left.start - right.start)
	for (let index = 1; index < sorted.length; index += 1) {
		const previous = sorted[index - 1]!
		const current = sorted[index]!
		if (previous.end > current.start) failInvalidInput(`edits[${previous.index}] and edits[${current.index}] overlap in ${path}.`)
	}
}

function applyMatches(content: string, matches: MatchedEdit[]): string {
	return [...matches]
		.sort((left, right) => right.start - left.start)
		.reduce((current, match) => `${current.slice(0, match.start)}${match.newText}${current.slice(match.end)}`, content)
}

function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith('\uFEFF') ? { bom: '\uFEFF', text: content.slice(1) } : { bom: '', text: content }
}

function detectLineEnding(content: string): '\n' | '\r\n' {
	const crlf = content.indexOf('\r\n')
	const lf = content.indexOf('\n')
	return crlf !== -1 && (lf === -1 || crlf < lf) ? '\r\n' : '\n'
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function restoreLineEndings(text: string, lineEnding: '\n' | '\r\n'): string {
	return lineEnding === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

async function redactOrFail(context: CoreAgentRunToolContext, text: string): Promise<string> {
	const redacted = await context.sandbox.redactText({ text })
	if (!redacted.ok) failSandboxError(sandboxErrorSummary(redacted.error))
	return redacted.value
}

function simpleDiff(path: string, before: string, after: string): string {
	const oldLines = before.split('\n')
	const newLines = after.split('\n')
	const prefix = commonPrefixLength(oldLines, newLines)
	const suffix = commonSuffixLength(oldLines, newLines, prefix)
	const contextStart = Math.max(0, prefix - 3)
	const oldChangeEnd = oldLines.length - suffix
	const newChangeEnd = newLines.length - suffix
	return [
		`--- ${path}`,
		`+++ ${path}`,
		...(contextStart > 0 ? [' ...'] : []),
		...oldLines.slice(contextStart, prefix).map((line) => ` ${line}`),
		...oldLines.slice(prefix, oldChangeEnd).map((line) => `-${line}`),
		...newLines.slice(prefix, newChangeEnd).map((line) => `+${line}`),
		...oldLines.slice(oldChangeEnd, Math.min(oldLines.length, oldChangeEnd + 3)).map((line) => ` ${line}`),
		...(oldChangeEnd + 3 < oldLines.length ? [' ...'] : []),
	].join('\n')
}

function simplePatch(path: string, before: string, after: string): string {
	return `--- ${path}\n+++ ${path}\n@@\n${simpleDiff(path, before, after).split('\n').slice(2).join('\n')}`
}

function commonPrefixLength(left: string[], right: string[]): number {
	let index = 0
	while (index < left.length && index < right.length && left[index] === right[index]) index += 1
	return index
}

function commonSuffixLength(left: string[], right: string[], prefix: number): number {
	let count = 0
	while (
		count + prefix < left.length &&
		count + prefix < right.length &&
		left[left.length - 1 - count] === right[right.length - 1 - count]
	)
		count += 1
	return count
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('edit tool', () => {
		it('applies exact edits atomically while preserving BOM and CRLF line endings', async () => {
			const fixture = toolFixture({ '/workspace/file.txt': '\uFEFFalpha\r\nbeta\r\ngamma\r\nsecret\r\n' })
			const output = await editTool().execute(
				{ path: 'file.txt', edits: [{ oldText: 'beta\n', newText: 'BETA\n' }] },
				fixture.context,
			)
			expect(fixture.files.get('/workspace/file.txt')).toBe('\uFEFFalpha\r\nBETA\r\ngamma\r\nsecret\r\n')
			expect(output.output).toMatchObject({ type: 'diff', summary: 'Successfully replaced 1 block(s) in /workspace/file.txt.' })
			expect(output.output.type === 'diff' && output.output.diff.includes('REDACTED')).toBe(true)
		})

		it('rejects invalid edits without writing', async () => {
			const fixture = toolFixture({ '/workspace/file.txt': 'alpha beta beta' })
			await expect(
				editTool().execute({ path: 'file.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] }, fixture.context),
			).rejects.toMatchObject({ reason: { type: 'invalid-input' } })
			expect(fixture.files.get('/workspace/file.txt')).toBe('alpha beta beta')
			await expect(
				editTool().execute({ path: 'file.txt', edits: [{ oldText: '', newText: 'x' }] }, fixture.context),
			).rejects.toMatchObject({ reason: { type: 'invalid-input' } })
			await expect(
				editTool().execute({ path: 'file.txt', edits: [{ oldText: 'alpha', newText: 'alpha' }] }, fixture.context),
			).rejects.toMatchObject({ reason: { type: 'invalid-input' } })
		})

		it('rejects overlapping and non-UTF-8 edits', async () => {
			await expect(
				editTool().execute(
					{
						path: 'file.txt',
						edits: [
							{ oldText: 'abc', newText: 'ABC' },
							{ oldText: 'bc', newText: 'BC' },
						],
					},
					toolFixture({ '/workspace/file.txt': 'abc' }).context,
				),
			).rejects.toMatchObject({ reason: { type: 'invalid-input' } })
			await expect(
				editTool().execute(
					{ path: 'binary.dat', edits: [{ oldText: 'x', newText: 'y' }] },
					toolFixture({ '/workspace/binary.dat': Buffer.from([0xff]) }).context,
				),
			).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
		})
	})

	function toolFixture(initial: Record<string, string | Buffer>) {
		const files = new Map(Object.entries(initial))
		const context: CoreAgentRunToolContext = {
			agentRunId: '01k00000000000000000000002',
			assistantMessageEventId: '01k00000000000000000000003',
			toolCallId: 'call-1',
			signal: new AbortController().signal,
			onUpdate: () => {},
			recordProposal: () => Promise.resolve(toolOutput('proposal')),
			sandbox: fakeSandbox(files),
		}
		return { files, context }
	}

	function fakeSandbox(files: Map<string, string | Buffer>): ManagedSandbox {
		return {
			setEnv: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			runCommand: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			readFile: ({ path }) => Promise.resolve({ ok: true, value: fakeReadFile(files, path) }),
			writeFile: ({ path, contentsBase64 }) => {
				files.set(path, Buffer.from(contentsBase64, 'base64').toString('utf8'))
				return Promise.resolve({ ok: true, value: undefined })
			},
			listDirectory: () => Promise.resolve({ ok: true, value: null }),
			deletePath: () => Promise.resolve({ ok: true, value: undefined }),
			redactText: ({ text }) => Promise.resolve({ ok: true, value: text.replaceAll('secret', 'REDACTED') }),
			redactJson: ({ value }) => Promise.resolve({ ok: true, value }),
			release: () => Promise.resolve({ ok: true, value: { summary: 'released' } }),
		}
	}

	function fakeReadFile(files: Map<string, string | Buffer>, path: string) {
		const value = files.get(path)
		if (value !== undefined) return { type: 'file' as const, contentsBase64: Buffer.from(value).toString('base64') }
		return null
	}
}
