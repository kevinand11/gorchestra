import type { ModelMessage } from 'ai'

import type { AgentRunLiveEvent } from './live-events'
import type { CoreAgentRunTool } from './tools'
import type { AgentRun, AgentRunEvent, AgentRunEventCursor, AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { ModelThinkingLevel } from '../../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreProviders } from '../../providers'
import type { CoreServices } from '../../services'
import type { CoreRuntimeValues } from '../../utils/runtime-values'

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

export type AgentRunRuntimeError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export interface RunModelAgentRunOptions {
	signal?: AbortSignal
	onEvent?(event: AgentRunLiveEvent): void | Promise<void>
}

export interface ModelAgentRunRuntime {
	services: CoreServices
	providers: CoreProviders
	values: CoreRuntimeValues
}

export interface AgentRunLoopState {
	agentRun: AgentRun
	events: AgentRunEvent[]
	tools: CoreAgentRunTool[]
}

export type TurnResult = { type: 'completed' } | { type: 'failed' }
