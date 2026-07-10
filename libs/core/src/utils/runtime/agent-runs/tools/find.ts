import { relative } from 'node:path/posix'

import { v, type Pipe } from 'valleyed'

import { commandText, runNonRootWorkspaceShell, shellQuote } from './command'
import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, toolOutput } from './results'
import { resultLimitTruncation, truncateSearchText } from './truncation'
import type { AgentRunToolOutput } from '../../../../domain/agent-run-event'
import { nonEmptyTrimmedStringPipe, positiveIntegerPipe } from '../../../../domain/commons'
import type { SandboxCommandOutput } from '../../../../services'
import type { CoreAgentRunToolContext } from '../types'

const defaultFindLimit = 1000
const findTimeoutMs = 30_000

type FindInput = { pattern: string; path: string | undefined; limit: number | undefined }
const findInputPipe: Pipe<unknown, FindInput> = v.object({
	pattern: nonEmptyTrimmedStringPipe,
	path: v.optional(nonEmptyTrimmedStringPipe),
	limit: v.optional(positiveIntegerPipe),
})

export function findTool(): CoreAgentRunToolDefinition<FindInput> {
	return {
		name: 'find',
		contractVersion: 1,
		description:
			'Search for files by glob pattern using fd. Returns matching paths relative to the search path. Respects ignore rules. Output is truncated to 1000 results or 50KB.',
		inputPipe: findInputPipe,
		promptSnippet: 'Find files by glob pattern using fd, respecting ignore rules',
		promptGuidelines: [
			'Use find when you know a filename or glob pattern but not the exact path.',
			'Prefer targeted patterns such as "*.ts" or "src/**/*.spec.ts" over broad repository scans.',
		],
		workspaceMutationKind: 'read-only',
		execute: (input, context) => findWorkspaceFiles(input, context),
	}
}

async function findWorkspaceFiles(input: FindInput, context: CoreAgentRunToolContext): Promise<AgentRunToolOutput> {
	const searchPath = resolveSearchPath(input.path)
	const limit = Math.min(input.limit ?? defaultFindLimit, defaultFindLimit)
	const output = await runNonRootWorkspaceShell({
		context,
		label: 'Agent Run find tool',
		script: findScript(input.pattern, searchPath, limit),
		timeoutMs: findTimeoutMs,
	})
	if (output.exitCode !== 0 && isEmpty(output.stdout))
		failInvalidInput(commandText(output) || `fd exited with status ${output.exitCode}.`)
	return findOutput(output, searchPath, limit)
}

function resolveSearchPath(inputPath: string | undefined): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: true })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid find path.')
	return path.value
}

function findScript(pattern: string, searchPath: string, limit: number): string {
	const { pattern: effectivePattern, fullPathFlag } = effectiveFindPattern(pattern)
	return `set -eu
search_root=${shellQuote(searchPath)}
pattern=${shellQuote(effectivePattern)}
if [ ! -e "$search_root" ]; then
  printf '%s\n' "Path not found: $search_root" >&2
  exit 2
fi
inside_git=0
current="$search_root"
while [ "$current" != "/" ]; do
  if [ -e "$current/.git" ]; then inside_git=1; break; fi
  current="\${current%/*}"
  if [ -z "$current" ]; then current="/"; fi
done
no_require_git=
if [ "$inside_git" -eq 0 ]; then no_require_git='--no-require-git'; fi
full_path_flag=${shellQuote(fullPathFlag)}
exec fd --glob --color=never --hidden --exclude .gorchestra $no_require_git $full_path_flag --max-results ${limit} -- "$pattern" "$search_root"`
}

function effectiveFindPattern(pattern: string): { pattern: string; fullPathFlag: '' | '--full-path' } {
	if (!pattern.includes('/')) return { pattern, fullPathFlag: '' }
	return {
		pattern: pattern.startsWith('/') || pattern.startsWith('**/') || pattern === '**' ? pattern : `**/${pattern}`,
		fullPathFlag: '--full-path',
	}
}

function findOutput(output: SandboxCommandOutput, searchPath: string, limit: number): AgentRunToolOutput {
	const paths = relativizedFindLines(output.stdout ?? '', searchPath)
	if (paths.length === 0) return toolOutput('No files found matching pattern')
	const raw = paths.slice(0, limit).join('\n')
	const truncated = truncateSearchText(raw)
	const resultLimitReached = paths.length >= limit
	const notices = [
		...(resultLimitReached ? [`${limit} results limit reached`] : []),
		...(truncated.truncation === null ? [] : ['50KB output limit reached']),
	]
	return {
		output: { type: 'text', value: `${truncated.content}${notices.length === 0 ? '' : `\n\n[${notices.join('. ')}]`}` },
		truncation: truncated.truncation ?? resultLimitTruncation(paths.length, limit, truncated.content),
	}
}

function relativizedFindLines(stdout: string, searchPath: string): string[] {
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => relativizeFoundPath(line, searchPath))
}

function relativizeFoundPath(line: string, searchPath: string): string {
	const hadTrailingSlash = line.endsWith('/')
	const withoutTrailingSlash = hadTrailingSlash ? line.slice(0, -1) : line
	const relativePath = withoutTrailingSlash.startsWith(`${searchPath}/`)
		? withoutTrailingSlash.slice(searchPath.length + 1)
		: withoutTrailingSlash.startsWith('/workspace/')
			? relative(searchPath, withoutTrailingSlash)
			: withoutTrailingSlash
	return hadTrailingSlash && !relativePath.endsWith('/') ? `${relativePath}/` : relativePath
}

function isEmpty(value: string | null): boolean {
	return value === null || value.trim().length === 0
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { commandToolFixture } = await import('./command-test-helpers')

	describe('find tool', () => {
		it('runs fd through non-root sh with path policy, full-path patterns, and a 30s timeout', async () => {
			const fixture = commandToolFixture({ exitCode: 0, summary: 'ok', stdout: '/workspace/src/app.test.ts\n', stderr: null })
			await expect(
				findTool().execute({ pattern: 'src/**/*.test.ts', path: undefined, limit: undefined }, fixture.context),
			).resolves.toEqual(toolOutput('src/app.test.ts'))
			expect(fixture.commands).toHaveLength(1)
			expect(fixture.commands[0]).toMatchObject({
				root: false,
				timeoutMs: 30_000,
				command: { executable: 'sh', args: ['-c', expect.stringContaining('fd --glob')] },
			})
			expect(fixture.commands[0]?.command.args[1]).toContain('--full-path')
			expect(fixture.commands[0]?.command.args[1]).toContain('**/src/**/*.test.ts')
		})

		it('reports no matches and invalid patterns', async () => {
			await expect(
				findTool().execute(
					{ pattern: '*.md', path: 'docs', limit: undefined },
					commandToolFixture({ exitCode: 0, summary: 'ok', stdout: null, stderr: null }).context,
				),
			).resolves.toEqual(toolOutput('No files found matching pattern'))
			await expect(
				findTool().execute(
					{ pattern: '[bad', path: undefined, limit: undefined },
					commandToolFixture({ exitCode: 2, summary: 'bad glob', stdout: null, stderr: 'glob parse error' }).context,
				),
			).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
		})
	})
}
