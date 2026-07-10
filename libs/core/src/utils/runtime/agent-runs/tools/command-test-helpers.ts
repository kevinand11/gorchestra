import { toolOutput } from './results'
import type { AgentRunToolOutput } from '../../../../domain/agent-run-event'
import type { SandboxCommandOutput } from '../../../../services'
import type { ManagedSandbox, ManagedSandboxRunCommandInput } from '../../sandboxes/managed'
import type { CoreAgentRunToolContext } from '../types'

export function commandToolFixture(
	output: SandboxCommandOutput,
	options: { proposalOutput?: AgentRunToolOutput } = {},
): { context: CoreAgentRunToolContext; commands: ManagedSandboxRunCommandInput[]; updates: unknown[] } {
	const commands: ManagedSandboxRunCommandInput[] = []
	const updates: unknown[] = []
	const context: CoreAgentRunToolContext = {
		agentRunId: '01k00000000000000000000002',
		assistantMessageEventId: '01k00000000000000000000003',
		toolCallId: 'call-1',
		signal: new AbortController().signal,
		onUpdate: (update) => updates.push(update),
		recordProposal: () => Promise.resolve(options.proposalOutput ?? toolOutput('proposal')),
		sandbox: fakeSandbox(output, commands),
	}
	return { context, commands, updates }
}

function fakeSandbox(output: SandboxCommandOutput, commands: ManagedSandboxRunCommandInput[]): ManagedSandbox {
	return {
		setEnv: () => Promise.resolve({ ok: true, value: { exitCode: 0, summary: 'ok', stdout: null, stderr: null } }),
		runCommand: (input) => {
			commands.push(input)
			return Promise.resolve({ ok: true, value: output })
		},
		readFile: () => Promise.resolve({ ok: true, value: null }),
		writeFile: () => Promise.resolve({ ok: true, value: undefined }),
		listDirectory: () => Promise.resolve({ ok: true, value: null }),
		deletePath: () => Promise.resolve({ ok: true, value: undefined }),
		redactText: ({ text }) => Promise.resolve({ ok: true, value: text }),
		redactJson: ({ value }) => Promise.resolve({ ok: true, value }),
		release: () => Promise.resolve({ ok: true, value: { summary: 'released' } }),
	}
}
