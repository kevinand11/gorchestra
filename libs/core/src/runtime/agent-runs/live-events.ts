import type { AgentRunEvent, AgentRunEventCursor } from '../../domain/agent-run'

export type AgentRunLiveEvent =
	| { type: 'persisted'; event: AgentRunEvent }
	| { type: 'assistant-message-draft-updated'; turnStartedCursor: AgentRunEventCursor; draftId: string; delta: AgentRunModelDelta }
	| { type: 'tool-call-updated'; turnStartedCursor: AgentRunEventCursor; toolCallId: string; update: AgentRunToolUpdate }

export type AgentRunModelDelta =
	| { type: 'model-output-started' }
	| { type: 'text-started'; contentIndex: number }
	| { type: 'text-delta'; contentIndex: number; delta: string }
	| { type: 'text-ended'; contentIndex: number; text: string }
	| { type: 'thinking-started'; contentIndex: number }
	| { type: 'thinking-delta'; contentIndex: number; delta: string }
	| { type: 'thinking-ended'; contentIndex: number; text: string }
	| { type: 'tool-call-arguments-started'; contentIndex: number; toolCallId: string; toolName: string }
	| { type: 'tool-call-arguments-delta'; contentIndex: number; toolCallId: string; delta: string }
	| { type: 'tool-call-arguments-ended'; contentIndex: number; toolCallId: string; toolName: string; input: unknown }
	| { type: 'model-output-ended' }

export type AgentRunToolUpdate =
	| { type: 'text-delta'; delta: string }
	| { type: 'progress'; label: string; current: number | null; total: number | null }
	| { type: 'structured'; value: unknown }
