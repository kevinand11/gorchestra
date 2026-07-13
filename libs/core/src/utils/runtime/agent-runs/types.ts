import type { ModelMessage } from 'ai'

import type { CoreAgentRunToolDefinition } from './tools'
import type { AgentRun } from '../../../domain/agent-run'
import type { AgentRunEvent, AgentRunToolOutput } from '../../../domain/agent-run-event'
import type { Id } from '../../../domain/commons'
import type { ModelThinkingLevel } from '../../../domain/model'
import type { ToolCallUpdate } from '../../../domain/notifications'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SandboxOperationFailedError,
	SandboxProviderResolutionFailedError,
	StorageOperationFailedError,
} from '../../../errors'
import type { CoreServices } from '../../../services'
import type { NotificationEmitter } from '../../notifications'
import type { CoreProviders } from '../../providers'
import type { CoreRuntimeValues } from '../../runtime-values'
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
	onUpdate(update: ToolCallUpdate): Promise<void>
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
}

export interface ModelAgentRunRuntime {
	services: CoreServices
	providers: CoreProviders
	notifications: NotificationEmitter
	values: CoreRuntimeValues
}

export interface AgentRunLoopState {
	agentRun: AgentRun
	events: AgentRunEvent[]
	tools: CoreAgentRunToolDefinition[]
	sandbox: ManagedSandbox
}

export type TurnResult = { type: 'completed' } | { type: 'failed' }
