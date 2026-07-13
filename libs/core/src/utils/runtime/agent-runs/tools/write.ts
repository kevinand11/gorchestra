import { v, type Pipe } from 'valleyed'

import { resolveWorkspaceToolPath } from './path-policy'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, failSandboxError, sandboxErrorSummary, toolOutput } from './results'
import { lineCount } from './truncation'
import { nonEmptyTrimmedStringPipe } from '../../../../domain/commons'
import type { ManagedSandbox } from '../../sandboxes/managed'
import type { CoreAgentRunToolContext } from '../types'

type WriteInput = { path: string; content: string }
const writeInputPipe: Pipe<unknown, WriteInput> = v.object({ path: nonEmptyTrimmedStringPipe, content: v.string() })

export function writeTool(): CoreAgentRunToolDefinition<WriteInput> {
	return {
		name: 'write',
		contractVersion: 1,
		description:
			'Write UTF-8 text content to a file. Creates parent directories if needed and overwrites the file if it already exists.',
		inputPipe: writeInputPipe,
		promptSnippet: 'Create or overwrite files',
		promptGuidelines: ['Use write only for new files or complete rewrites. Use edit for targeted changes to existing files.'],
		workspaceMutationKind: 'file-mutator',
		workspaceMutationKey: (input) => resolveWorkspaceToolPath(input.path, { defaultPath: '/workspace', allowWorkspaceRoot: false }),
		execute: (input, context) => writeWorkspaceFile(input, context),
	}
}

async function writeWorkspaceFile(input: WriteInput, context: CoreAgentRunToolContext) {
	const path = resolvePathOrFail(input.path)
	const contentsBase64 = Buffer.from(input.content, 'utf8').toString('base64')
	const write = await context.sandbox.writeFile({ path, contentsBase64 })
	if (!write.ok) failSandboxError(sandboxErrorSummary(write.error))
	const bytes = Buffer.byteLength(input.content, 'utf8')
	const lines = lineCount(input.content)
	return toolOutput(`Wrote ${bytes} byte(s), ${lines} line(s) to ${path}.`)
}

function resolvePathOrFail(inputPath: string): string {
	const path = resolveWorkspaceToolPath(inputPath, { defaultPath: '/workspace', allowWorkspaceRoot: false })
	if (!path.ok) failInvalidInput(path.error.output.type === 'text' ? path.error.output.value : 'Invalid write path.')
	return path.value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('write tool', () => {
		it('writes UTF-8 text through the managed sandbox and reports bytes and lines', async () => {
			const fixture = toolFixture()
			await expect(writeTool().execute({ path: 'dir/file.txt', content: 'hello\nworld\n' }, fixture.context)).resolves.toEqual(
				toolOutput('Wrote 12 byte(s), 2 line(s) to /workspace/dir/file.txt.'),
			)
			expect(fixture.files.get('/workspace/dir/file.txt')).toBe('hello\nworld\n')
		})

		it('overwrites existing files and rejects protected paths', async () => {
			const fixture = toolFixture({ '/workspace/file.txt': 'old' })
			await expect(writeTool().execute({ path: 'file.txt', content: 'new' }, fixture.context)).resolves.toMatchObject({
				output: { type: 'text' },
			})
			expect(fixture.files.get('/workspace/file.txt')).toBe('new')
			await expect(
				writeTool().execute({ path: '/workspace/.gorchestra/runtime-env.json', content: '{}' }, fixture.context),
			).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
		})
	})

	function toolFixture(initial: Record<string, string> = {}) {
		const files = new Map(Object.entries(initial))
		const context: CoreAgentRunToolContext = {
			agentRunId: '01k00000000000000000000002',
			assistantMessageEventId: '01k00000000000000000000003',
			toolCallId: 'call-1',
			signal: new AbortController().signal,
			onUpdate: () => Promise.resolve(),
			recordProposal: () => Promise.resolve(toolOutput('proposal')),
			sandbox: fakeSandbox(files),
		}
		return { files, context }
	}

	function fakeSandbox(files: Map<string, string>): ManagedSandbox {
		return {
			setEnv: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			runCommand: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
			writeFile: ({ path, contentsBase64 }) => {
				files.set(path, Buffer.from(contentsBase64, 'base64').toString('utf8'))
				return Promise.resolve({ ok: true, value: undefined })
			},
			readFile: () => Promise.resolve({ ok: true, value: null }),
			deletePath: () => Promise.resolve({ ok: true, value: undefined }),
			listDirectory: () => Promise.resolve({ ok: true, value: null }),
			redactJson: ({ value }) => Promise.resolve({ ok: true, value }),
			redactText: ({ text }) => Promise.resolve({ ok: true, value: text }),
			release: () => Promise.resolve({ ok: true, value: { summary: 'released' } }),
		}
	}
}
