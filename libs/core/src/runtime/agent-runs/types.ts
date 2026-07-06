import type { ModelMessage } from 'ai'

import type { AgentRunEventCursor, AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { ModelThinkingLevel } from '../../domain/model'

export interface AgentRunModelContext {
	messages: ModelMessage[]
}

export interface AgentRunProviderTool {
	name: string
	description: string
	parameters: unknown
}

export type ModelAgentTurnThinking = { level: ModelThinkingLevel } | null

export interface ModelAgentTurnInput {
	messages: ModelMessage[]
	tools: AgentRunProviderTool[]
	thinking: ModelAgentTurnThinking
	signal: AbortSignal
}

export interface CoreAgentRunToolContext {
	agentRunId: Id
	assistantMessageCursor: AgentRunEventCursor
	toolCallId: string
	onUpdate(
		update:
			| { type: 'text-delta'; delta: string }
			| { type: 'progress'; label: string; current: number | null; total: number | null }
			| { type: 'structured'; value: unknown },
	): void
	signal: AbortSignal
	recordProposal(body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown }): Promise<AgentRunToolOutput>
}
