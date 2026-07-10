import { v, type Pipe } from 'valleyed'

import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, failSandboxError, sandboxErrorSummary, toolOutput } from './results'
import { listMaxEntries, resultLimitTruncation, truncateSearchText } from './truncation'
import type { AgentRunToolOutput, AgentRunToolTruncation } from '../../../../domain/agent-run-event'
import { nonEmptyTrimmedStringPipe, positiveIntegerPipe } from '../../../../domain/commons'
import type { SandboxFileEntry } from '../../../../services'
import type { ManagedSandbox } from '../../sandboxes/managed'
import type { CoreAgentRunToolContext } from '../types'

type LsInput = { path: string | undefined; limit: number | undefined }
const lsInputPipe: Pipe<unknown, LsInput> = v.object({
	path: v.optional(nonEmptyTrimmedStringPipe),
	limit: v.optional(positiveIntegerPipe),
})

export function lsTool(): CoreAgentRunToolDefinition<LsInput> {
	return {
		name: 'ls',
		contractVersion: 1,
		description:
			'List directory contents. Returns entries sorted alphabetically with / suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB.',
		inputPipe: lsInputPipe,
		promptSnippet: 'List directory contents',
		promptGuidelines: ['Use ls to inspect directory contents before reading files when the exact file path is unknown.'],
		workspaceMutationKind: 'read-only',
		execute: (input, context) => listWorkspaceDirectory(input, context),
	}
}

async function listWorkspaceDirectory(input: LsInput, context: CoreAgentRunToolContext): Promise<AgentRunToolOutput> {
	const path = resolvePathOrFail(input.path)
	const listed = await context.sandbox.listDirectory({ path })
	if (!listed.ok) failSandboxError(sandboxErrorSummary(listed.error))
	if (listed.value === null) failInvalidInput(`Path not found: ${path}.`)
	if (listed.value.type === 'file') failInvalidInput(`Cannot list file as a directory: ${path}. Use read instead.`)
	if (listed.value.type === 'other') failInvalidInput(`Cannot list non-directory path: ${path}.`)
	return directoryListingOutput(formatEntries(listed.value.entries), input.limit)
}

function resolvePathOrFail(inputPath: string | undefined): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: true })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid list path.')
	return path.value
}

function formatEntries(entries: SandboxFileEntry[]): string[] {
	return [...entries]
		.sort(
			(left, right) =>
				left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase()) || left.name.localeCompare(right.name),
		)
		.map((entry) => (entry.type === 'directory' ? `${entry.name}/` : entry.name))
}

function directoryListingOutput(entries: string[], requestedLimit: number | undefined): AgentRunToolOutput {
	if (entries.length === 0) return toolOutput('(empty directory)')
	const effectiveLimit = Math.min(requestedLimit ?? listMaxEntries, listMaxEntries)
	const entryLimited = entries.length > effectiveLimit
	const selected = entries.slice(0, effectiveLimit).join('\n')
	const truncated = truncateSearchText(selected)
	const notices = listingNotices(entryLimited, effectiveLimit, truncated.truncation)
	return {
		output: { type: 'text', value: `${truncated.content}${notices.length === 0 ? '' : `\n\n[${notices.join('. ')}]`}` },
		truncation: truncated.truncation ?? resultLimitTruncation(entries.length, effectiveLimit, truncated.content),
	}
}

function listingNotices(entryLimited: boolean, effectiveLimit: number, truncation: AgentRunToolTruncation | null): string[] {
	return [
		...(entryLimited ? [`${effectiveLimit} entries limit reached`] : []),
		...(truncation === null ? [] : ['50KB output limit reached']),
	]
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ls tool', () => {
		it('lists directories with case-insensitive sorting, directory suffixes, and dotfiles', async () => {
			await expect(
				lsTool().execute(
					lsInput('src'),
					toolContext({
						'/workspace/src/B.ts': 'b',
						'/workspace/src/a.ts': 'a',
						'/workspace/src/.env': 'x',
						'/workspace/src/lib/file.ts': 'x',
					}),
				),
			).resolves.toEqual(toolOutput('.env\na.ts\nB.ts\nlib/'))
		})

		it('returns empty directory text and records entry-limit truncation', async () => {
			await expect(
				lsTool().execute(lsInput('empty'), toolContext({ '/workspace/empty/.keep': 'x' }, ['/workspace/empty/.keep'])),
			).resolves.toEqual(toolOutput('(empty directory)'))

			const files = Object.fromEntries(
				Array.from({ length: 501 }, (_, index) => [`/workspace/many/${String(index).padStart(3, '0')}.txt`, 'x']),
			)
			const output = await lsTool().execute(lsInput('many'), toolContext(files))
			expect(output.output.type === 'text' && output.output.value).toContain('500 entries limit reached')
			expect(output.truncation).toMatchObject({ strategy: 'result-limit', originalLines: 501, outputLines: 500 })
		})

		it('rejects protected, missing, and file paths', async () => {
			await expect(lsTool().execute(lsInput('/workspace/.gorchestra'), toolContext({}))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
			await expect(lsTool().execute(lsInput('missing'), toolContext({}))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
			await expect(lsTool().execute(lsInput('file.txt'), toolContext({ '/workspace/file.txt': 'x' }))).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
		})
	})

	function lsInput(path: string): LsInput {
		return { path, limit: undefined }
	}

	function toolContext(files: Record<string, string>, emptyDirectories: string[] = []): CoreAgentRunToolContext {
		return {
			agentRunId: '01k00000000000000000000002',
			assistantMessageEventId: '01k00000000000000000000003',
			toolCallId: 'call-1',
			signal: new AbortController().signal,
			onUpdate: () => {},
			recordProposal: () => Promise.resolve(toolOutput('proposal')),
			sandbox: fakeSandbox(files, emptyDirectories),
		}
	}

	function fakeSandbox(files: Record<string, string>, emptyDirectoryFiles: string[]): ManagedSandbox {
		return {
			setEnv: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			runCommand: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			readFile: () => Promise.resolve({ ok: true, value: null }),
			writeFile: () => Promise.resolve({ ok: true, value: undefined }),
			listDirectory: ({ path }) => Promise.resolve({ ok: true, value: fakeListDirectory(files, emptyDirectoryFiles, path) }),
			deletePath: () => Promise.resolve({ ok: true, value: undefined }),
			redactText: ({ text }) => Promise.resolve({ ok: true, value: text }),
			redactJson: ({ value }) => Promise.resolve({ ok: true, value }),
			release: () => Promise.resolve({ ok: true, value: { summary: 'released' } }),
		}
	}

	function fakeListDirectory(files: Record<string, string>, emptyDirectoryFiles: string[], path: string) {
		if (files[path] !== undefined) return { type: 'file' as const }
		const entries = new Map<string, 'file' | 'directory'>()
		for (const filePath of Object.keys(files).filter((filePath) => !emptyDirectoryFiles.includes(filePath))) {
			if (!filePath.startsWith(`${path}/`)) continue
			const [name, nested] = filePath.slice(path.length + 1).split('/')
			if (name !== undefined && name.length > 0) entries.set(name, nested === undefined ? 'file' : 'directory')
		}
		if (entries.size === 0)
			return emptyDirectoryFiles.some((filePath) => filePath.startsWith(`${path}/`))
				? { type: 'directory' as const, entries: [] }
				: null
		return { type: 'directory' as const, entries: [...entries].map(([name, type]) => ({ name, type })) }
	}
}
