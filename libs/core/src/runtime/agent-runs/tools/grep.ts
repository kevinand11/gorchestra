import { relative } from 'node:path/posix'

import { v, type Pipe } from 'valleyed'

import { commandText, runNonRootWorkspaceShell, shellQuote } from './command'
import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, toolOutput } from './results'
import { resultLimitTruncation, truncateLine, truncateSearchText } from './truncation'
import type { AgentRunToolOutput } from '../../../domain/agent-run'
import { nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from '../../../domain/commons'
import type { SandboxCommandOutput } from '../../../services'
import type { CoreAgentRunToolContext } from '../types'

const defaultGrepLimit = 100
const grepTimeoutMs = 30_000

type GrepInput = {
	pattern: string
	path: string | undefined
	glob: string | undefined
	ignoreCase: boolean | undefined
	literal: boolean | undefined
	context: number | undefined
	limit: number | undefined
}
const grepInputPipe: Pipe<unknown, GrepInput> = v.object({
	pattern: nonEmptyTrimmedStringPipe,
	path: v.optional(nonEmptyTrimmedStringPipe),
	glob: v.optional(nonEmptyTrimmedStringPipe),
	ignoreCase: v.optional(v.boolean()),
	literal: v.optional(v.boolean()),
	context: v.optional(nonNegativeIntegerPipe),
	limit: v.optional(positiveIntegerPipe),
})

interface GrepLine {
	kind: 'match' | 'context'
	path: string
	lineNumber: number
	text: string
}

export function grepTool(): CoreAgentRunToolDefinition<GrepInput> {
	return {
		name: 'grep',
		contractVersion: 1,
		description:
			'Search file contents with ripgrep. Returns matching lines with paths and line numbers. Respects ignore rules. Output is truncated to 100 matches or 50KB; long lines are truncated to 500 characters.',
		inputPipe: grepInputPipe,
		promptSnippet: 'Search file contents for patterns using rg, respecting ignore rules',
		promptGuidelines: [
			'Use grep to search file contents before reading large files.',
			'Prefer literal=true when searching for fixed strings that may contain regex characters.',
			'Use glob to narrow the file set when possible.',
		],
		workspaceMutationKind: 'read-only',
		execute: (input, context) => grepWorkspaceFiles(input, context),
	}
}

async function grepWorkspaceFiles(input: GrepInput, context: CoreAgentRunToolContext): Promise<AgentRunToolOutput> {
	const searchPath = resolveSearchPath(input.path)
	const limit = Math.min(input.limit ?? defaultGrepLimit, defaultGrepLimit)
	const output = await runNonRootWorkspaceShell({
		context,
		label: 'Agent Run grep tool',
		script: grepScript(input, searchPath),
		timeoutMs: grepTimeoutMs,
	})
	if (output.exitCode === 1) return toolOutput('No matches found')
	if (output.exitCode !== 0) failInvalidInput(commandText(output) || `rg exited with status ${output.exitCode}.`)
	return grepOutput(output, searchPath, limit)
}

function resolveSearchPath(inputPath: string | undefined): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: true })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid grep path.')
	return path.value
}

function grepScript(input: GrepInput, searchPath: string): string {
	return `set -eu
search_root=${shellQuote(searchPath)}
pattern=${shellQuote(input.pattern)}
if [ ! -e "$search_root" ]; then
  printf '%s\n' "Path not found: $search_root" >&2
  exit 2
fi
exec rg --json --line-number --color=never --hidden --glob '!**/.gorchestra/**'${input.ignoreCase === true ? ' --ignore-case' : ''}${input.literal === true ? ' --fixed-strings' : ''}${input.context === undefined || input.context === 0 ? '' : ` --context ${input.context}`}${input.glob === undefined ? '' : ` --glob ${shellQuote(input.glob)}`} -- "$pattern" "$search_root"`
}

function grepOutput(output: SandboxCommandOutput, searchPath: string, limit: number): AgentRunToolOutput {
	const parsed = parseRipgrepJson(output.stdout ?? '', searchPath, limit)
	if (parsed.matchCount === 0) return toolOutput('No matches found')
	const raw = parsed.lines.map(formatGrepLine).join('\n')
	const truncated = truncateSearchText(raw)
	const notices = [
		...(parsed.limitReached ? [`${limit} matches limit reached`] : []),
		...(parsed.lineTruncated ? ['some lines truncated to 500 characters'] : []),
		...(truncated.truncation === null ? [] : ['50KB output limit reached']),
	]
	return {
		output: { type: 'text', value: `${truncated.content}${notices.length === 0 ? '' : `\n\n[${notices.join('. ')}]`}` },
		truncation: truncated.truncation ?? resultLimitTruncation(parsed.matchCount, limit, truncated.content),
	}
}

function parseRipgrepJson(
	stdout: string,
	searchPath: string,
	limit: number,
): { lines: GrepLine[]; matchCount: number; limitReached: boolean; lineTruncated: boolean } {
	const lines: GrepLine[] = []
	let matchCount = 0
	let limitReached = false
	let lineTruncated = false
	for (const rawLine of stdout.split('\n')) {
		if (rawLine.trim().length === 0) continue
		const event = jsonRecord(rawLine)
		if (event === null) continue
		const parsed = grepLineFromEvent(event, searchPath)
		if (parsed === null) continue
		if (parsed.kind === 'match') {
			matchCount += 1
			if (matchCount > limit) {
				limitReached = true
				continue
			}
		} else if (matchCount >= limit) {
			continue
		}
		const truncatedLine = truncateLine(parsed.text)
		lineTruncated ||= truncatedLine.truncated
		lines.push({ ...parsed, text: truncatedLine.text })
	}
	return { lines, matchCount, limitReached: limitReached || matchCount >= limit, lineTruncated }
}

function grepLineFromEvent(event: Record<string, unknown>, searchPath: string): GrepLine | null {
	if (event.type !== 'match' && event.type !== 'context') return null
	const data = recordValue(event.data)
	const path = stringValue(recordValue(data?.path)?.text)
	const lineNumber = numberValue(data?.line_number)
	const text = stringValue(recordValue(data?.lines)?.text)
	return path === null || lineNumber === null || text === null
		? null
		: { kind: event.type, path: relativizePath(path, searchPath), lineNumber, text: sanitizeLine(text) }
}

function formatGrepLine(line: GrepLine): string {
	return line.kind === 'match' ? `${line.path}:${line.lineNumber}: ${line.text}` : `${line.path}-${line.lineNumber}- ${line.text}`
}

function sanitizeLine(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/\n$/, '')
}

function relativizePath(path: string, searchPath: string): string {
	return path.startsWith(`${searchPath}/`)
		? path.slice(searchPath.length + 1)
		: path.startsWith('/workspace/')
			? relative(searchPath, path)
			: path
}

function jsonRecord(line: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(line)
		return recordValue(parsed)
	} catch {
		return null
	}
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) ? value : null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { commandToolFixture } = await import('./command-test-helpers')

	describe('grep tool', () => {
		it('runs rg through non-root sh with filters and formats JSON matches', async () => {
			const stdout = [
				JSON.stringify({
					type: 'match',
					data: {
						path: { text: '/workspace/src/app.ts' },
						line_number: 7,
						lines: { text: `const value = '${'x'.repeat(510)}'\n` },
					},
				}),
			].join('\n')
			const fixture = commandToolFixture({ exitCode: 0, summary: 'ok', stdout, stderr: null })
			const output = await grepTool().execute(
				{ pattern: 'value', path: 'src', glob: '*.ts', ignoreCase: true, literal: true, context: 0, limit: undefined },
				fixture.context,
			)
			expect(output.output.type === 'text' && output.output.value).toContain('app.ts:7: const value =')
			expect(output.output.type === 'text' && output.output.value).toContain('some lines truncated to 500 characters')
			expect(fixture.commands[0]).toMatchObject({ root: false, timeoutMs: 30_000 })
			expect(fixture.commands[0]?.command.args[1]).toContain("--glob '*.ts'")
			expect(fixture.commands[0]?.command.args[1]).toContain('--fixed-strings')
		})

		it('maps no matches and invalid regexes to the expected outcomes', async () => {
			await expect(
				grepTool().execute(
					{
						pattern: 'missing',
						path: undefined,
						glob: undefined,
						ignoreCase: undefined,
						literal: undefined,
						context: undefined,
						limit: undefined,
					},
					commandToolFixture({ exitCode: 1, summary: 'no matches', stdout: null, stderr: null }).context,
				),
			).resolves.toEqual(toolOutput('No matches found'))
			await expect(
				grepTool().execute(
					{
						pattern: '[bad',
						path: undefined,
						glob: undefined,
						ignoreCase: undefined,
						literal: undefined,
						context: undefined,
						limit: undefined,
					},
					commandToolFixture({ exitCode: 2, summary: 'regex', stdout: null, stderr: 'regex parse error' }).context,
				),
			).rejects.toMatchObject({ reason: { type: 'invalid-input' } })
		})
	})
}
