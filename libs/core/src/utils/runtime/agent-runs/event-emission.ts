import type { AgentRunLiveEvent } from './live-events'
import type { AgentRunRuntimeError, ModelAgentRunRuntime, RunModelAgentRunOptions } from './types'
import type { AgentRunEvent } from '../../../domain/agent-run-event'
import type { Id } from '../../../domain/commons'
import { appendAgentRunEvent } from '../../agent-runs'
import type { Result } from '../../types'

export async function appendAndEmit(
	runtime: ModelAgentRunRuntime,
	agentRunId: Id,
	body: AgentRunEvent['body'],
	options: RunModelAgentRunOptions,
): Promise<Result<AgentRunEvent, AgentRunRuntimeError>> {
	const event = await appendAgentRunEvent(runtime, runtime.services.storage, agentRunId, body)
	if (event.ok) await emit(options, { type: 'persisted', event: event.value })
	return event
}

export async function emit(options: RunModelAgentRunOptions, event: AgentRunLiveEvent): Promise<void> {
	try {
		await options.onEvent?.(event)
	} catch {
		// Streaming is best-effort; storage remains source of truth.
	}
}
