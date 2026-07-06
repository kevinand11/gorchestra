import { toolOutput } from './tools'
import type { ModelAgentRunRuntime } from './types'
import type { AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import { appendAgentRunEvent } from '../../utils/agent-run-events'

export async function recordToolProposal(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	assistantMessageEventId: Id,
	toolCallId: string,
	body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown },
): Promise<AgentRunToolOutput> {
	const eventBody =
		body.type === 'proposed-plan-output'
			? { type: body.type, assistantMessageEventId, toolCallId, output: body.output as never }
			: { type: body.type, assistantMessageEventId, toolCallId, output: body.output as never }
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, eventBody)
	return event.ok
		? toolOutput(`${body.type} recorded for human review as event ${event.value.id}.`)
		: toolOutput(`Failed to record proposal: ${event.error.type}.`)
}
