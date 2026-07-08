import type { SandboxCommandOutput } from '../../../services'
import type { CoreAgentRunToolContext } from '../types'
import { failSandboxError, sandboxErrorSummary } from './results'
import { truncateCommandText } from './truncation'

export async function runNonRootWorkspaceShell(input: {
	context: CoreAgentRunToolContext
	label: string
	script: string
	timeoutMs: number
}): Promise<SandboxCommandOutput> {
	input.context.onUpdate({ type: 'progress', label: input.label, current: null, total: null })
	const output = await input.context.sandbox.runCommand({
		label: input.label,
		command: { executable: 'sh', args: ['-c', input.script], cwd: '/workspace' },
		commandSecretEnv: {},
		root: false,
		timeoutMs: input.timeoutMs,
	})
	if (!output.ok) failSandboxError(sandboxErrorSummary(output.error))
	return output.value
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}

export function commandToolOutput(output: SandboxCommandOutput) {
	const stdout = output.stdout === null ? null : truncateCommandText(output.stdout)
	const stderr = output.stderr === null ? null : truncateCommandText(output.stderr)
	return {
		output: {
			type: 'command' as const,
			exitCode: output.exitCode,
			stdout: stdout?.content ?? null,
			stderr: stderr?.content ?? null,
			stdoutTruncation: stdout?.truncation ?? null,
			stderrTruncation: stderr?.truncation ?? null,
		},
		truncation: null,
	}
}

export function commandText(output: SandboxCommandOutput): string {
	return [output.stdout, output.stderr].filter((value): value is string => value !== null && value.length > 0).join('\n')
}
