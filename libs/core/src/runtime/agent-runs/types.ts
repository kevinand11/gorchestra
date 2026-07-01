import type { AgentRunModelDelta, AgentRunToolUpdate } from './live-events'
import type { AgentRunModelMessageOutcome, AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'

export interface AgentRunModelContext {
	messages: AgentRunProviderMessage[]
}

export interface AgentRunProviderMessage {
	role: 'user' | 'assistant' | 'tool' | 'system'
	content: string
}

export interface AgentRunProviderTool {
	name: string
	description: string
	executionMode: 'parallel-safe' | 'exclusive'
	parameters: unknown
}

export interface ModelAgentTurnInput {
	messages: AgentRunProviderMessage[]
	tools: AgentRunProviderTool[]
	signal: AbortSignal
	onDelta(delta: AgentRunModelDelta): void
}

export interface ModelAgentTurnOutput {
	outcome: AgentRunModelMessageOutcome
}

export interface CoreAgentRunToolContext {
	agentRunId: Id
	toolCallScheduledEventId: Id
	onUpdate(update: AgentRunToolUpdate): void
	signal: AbortSignal
	recordProposal(body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown }): Promise<AgentRunToolOutput>
}
