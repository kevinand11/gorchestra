import type { AgentRunToolErrorReason, AgentRunToolOutput } from '../../../../domain/agent-run-event'
import type { ManagedSandboxError } from '../../sandboxes/managed'

export class AgentRunToolExecutionFailed extends Error {
	readonly reason: AgentRunToolErrorReason
	readonly output: AgentRunToolOutput

	constructor(reason: AgentRunToolErrorReason, output: AgentRunToolOutput) {
		super(output.output.type === 'text' || output.output.type === 'error-text' ? output.output.value : reason.type)
		this.reason = reason
		this.output = output
	}
}

export function toolOutput(text: string): AgentRunToolOutput {
	return { output: { type: 'text', value: text }, truncation: null }
}

export function toolErrorOutput(text: string): AgentRunToolOutput {
	return { output: { type: 'error-text', value: text }, truncation: null }
}

export function failToolExecution(reason: AgentRunToolErrorReason, output: AgentRunToolOutput): never {
	throw new AgentRunToolExecutionFailed(reason, output)
}

export function failInvalidInput(text: string): never {
	failToolExecution({ type: 'invalid-input' }, toolErrorOutput(text))
}

export function failSandboxError(text: string): never {
	failToolExecution({ type: 'sandbox-error' }, toolErrorOutput(text))
}

export function sandboxErrorSummary(error: ManagedSandboxError): string {
	switch (error.type) {
		case 'sandbox-operation-failed':
			return error.summary
		case 'invalid-core-service-output':
			return `Invalid ${error.service} ${error.operation} output.`
		default:
			throw new Error(`Unexpected managed sandbox error: ${String(error satisfies never)}`)
	}
}
