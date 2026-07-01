import type { AgentRunEvent } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'

export type AgentRunLiveEvent =
	| { type: 'persisted'; event: AgentRunEvent }
	| { type: 'model-message-updated'; modelMessageStartedEventId: Id; delta: AgentRunModelDelta }
	| { type: 'tool-call-updated'; toolCallStartedEventId: Id; update: AgentRunToolUpdate }

export type AgentRunModelDelta =
	| { type: 'text-delta'; delta: string }
	| { type: 'thinking-delta'; delta: string }
	| { type: 'tool-call-delta'; toolCallId: string; delta: string }

export type AgentRunToolUpdate =
	| { type: 'text-delta'; delta: string }
	| { type: 'progress'; label: string; current: number | null; total: number | null }
	| { type: 'structured'; value: unknown }
