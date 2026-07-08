import type { ModelMessage } from 'ai'

import type { AgentRunLiveEvent } from './live-events'
import type { CoreAgentRunToolDefinition } from './tools'
import type { AgentRun, AgentRunEvent, AgentRunToolOutput } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { ModelThinkingLevel } from '../../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SandboxOperationFailedError,
	SandboxProviderResolutionFailedError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreProviders } from '../../providers'
import type { CoreServices } from '../../services'
import type { CoreRuntimeValues } from '../../utils/runtime-values'
import type { ManagedSandbox } from '../sandboxes/managed'

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
	assistantMessageEventId: Id
	toolCallId: string
	onUpdate(
		update:
			| { type: 'text-delta'; delta: string }
			| { type: 'progress'; label: string; current: number | null; total: number | null }
			| { type: 'structured'; value: unknown },
	): void
	signal: AbortSignal
	recordProposal(body: { type: 'proposed-plan-output' | 'proposed-revision-output'; output: unknown }): Promise<AgentRunToolOutput>
	sandbox: ManagedSandbox
}

export type AgentRunRuntimeError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
	| SandboxOperationFailedError
	| SandboxProviderResolutionFailedError

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
	tools: CoreAgentRunToolDefinition[]
	sandbox: ManagedSandbox
}

export type TurnResult = { type: 'completed' } | { type: 'failed' }
