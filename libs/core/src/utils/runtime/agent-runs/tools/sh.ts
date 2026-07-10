import { v, type Pipe } from 'valleyed'

import { commandToolOutput, runNonRootWorkspaceShell } from './command'
import type { CoreAgentRunToolDefinition } from './registry'
import { failInvalidInput, failToolExecution } from './results'
import { nonEmptyRawStringPipe, positiveIntegerPipe } from '../../../../domain/commons'
import type { CoreAgentRunToolContext } from '../types'

const defaultShellTimeoutSeconds = 600
const maxShellTimeoutSeconds = 600

type ShInput = { command: string; timeout: number | undefined }
const shInputPipe: Pipe<unknown, ShInput> = v.object({ command: nonEmptyRawStringPipe, timeout: v.optional(positiveIntegerPipe) })

export function shTool(): CoreAgentRunToolDefinition<ShInput> {
	return {
		name: 'sh',
		contractVersion: 1,
		description:
			'Execute a POSIX sh command in /workspace. Runs as a non-root sandbox user with the prepared runtime environment. Output is redacted and truncated to the last 2000 lines or 50KB.',
		inputPipe: shInputPipe,
		promptSnippet: 'Execute POSIX sh commands in the sandbox when file tools are insufficient',
		promptGuidelines: [
			'Use sh for build, test, and project commands; prefer read/grep/find/ls/edit/write for simple file operations.',
			'Commands run from /workspace as non-root and should not assume elevated privileges.',
			'Provide a timeout in seconds only when the command needs less than the default 10 minutes.',
		],
		workspaceMutationKind: 'global-mutator',
		execute: (input, context) => executeShell(input, context),
	}
}

async function executeShell(input: ShInput, context: CoreAgentRunToolContext) {
	const timeoutMs = timeoutMsFromInput(input.timeout)
	const output = await runNonRootWorkspaceShell({ context, label: 'Agent Run sh tool', script: input.command, timeoutMs })
	const projected = commandToolOutput(output)
	context.onUpdate({ type: 'structured', value: { exitCode: output.exitCode } })
	if (output.exitCode !== 0) failToolExecution({ type: 'command-exit', exitCode: output.exitCode }, projected)
	return projected
}

function timeoutMsFromInput(timeout: number | undefined): number {
	const seconds = timeout ?? defaultShellTimeoutSeconds
	if (seconds > maxShellTimeoutSeconds) failInvalidInput(`sh timeout cannot exceed ${maxShellTimeoutSeconds} seconds.`)
	return seconds * 1000
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { commandToolFixture } = await import('./command-test-helpers')

	describe('sh tool', () => {
		it('executes exact sh -c commands as non-root in /workspace with the default timeout', async () => {
			const fixture = commandToolFixture({ exitCode: 0, summary: 'ok', stdout: 'done', stderr: null })
			await expect(shTool().execute({ command: 'pnpm test', timeout: undefined }, fixture.context)).resolves.toEqual({
				output: { type: 'command', exitCode: 0, stdout: 'done', stderr: null, stdoutTruncation: null, stderrTruncation: null },
				truncation: null,
			})
			expect(fixture.commands).toEqual([
				{
					label: 'Agent Run sh tool',
					command: { executable: 'sh', args: ['-c', 'pnpm test'], cwd: '/workspace' },
					commandSecretEnv: {},
					root: false,
					timeoutMs: 600_000,
				},
			])
			expect(fixture.updates).toEqual([
				{ type: 'progress', label: 'Agent Run sh tool', current: null, total: null },
				{ type: 'structured', value: { exitCode: 0 } },
			])
		})

		it('records non-zero exits as command-exit errors with structured command evidence', async () => {
			await expect(
				shTool().execute(
					{ command: 'exit 7', timeout: 5 },
					commandToolFixture({ exitCode: 7, summary: 'failed', stdout: null, stderr: 'boom' }).context,
				),
			).rejects.toMatchObject({
				reason: { type: 'command-exit', exitCode: 7 },
				output: { output: { type: 'command', exitCode: 7, stderr: 'boom' } },
			})
		})

		it('rejects timeouts above the 10 minute maximum', async () => {
			await expect(
				shTool().execute(
					{ command: 'sleep 1', timeout: 601 },
					commandToolFixture({ exitCode: 0, summary: 'ok', stdout: null, stderr: null }).context,
				),
			).rejects.toMatchObject({
				reason: { type: 'invalid-input' },
			})
		})
	})
}
