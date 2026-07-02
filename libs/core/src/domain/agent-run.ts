import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, freeFormStringPipe, idPipe, nonNegativeIntegerPipe, runtimeRecordPipe } from './commons'
import { modelThinkingLevelPipe } from './model'
import { planOutputProposalPipe, revisionOutputProposalPipe } from './proposals'

export const agentPipe = v.discriminate((value) => value.type, {
	model: v.object({ type: v.eq('model') }),
})
export type Agent = PipeOutput<typeof agentPipe>
export type ModelAgent = Extract<Agent, { type: 'model' }>

export const executionModePipe = v.discriminate((value) => value.type, {
	initial: v.object({ type: v.eq('initial') }),
	correction: v.object({ type: v.eq('correction'), failureChainRootActionId: idPipe }),
})
export type ExecutionMode = PipeOutput<typeof executionModePipe>

export const planningAgentRunPurposePipe = v.object({ type: v.eq('planning'), planId: idPipe })
export type PlanningAgentRunPurpose = PipeOutput<typeof planningAgentRunPurposePipe>

export const agentRunPurposePipe = v.discriminate((value) => value.type, {
	planning: planningAgentRunPurposePipe,
	'revision-planning': v.object({ type: v.eq('revision-planning'), revisionGateId: idPipe }),
	execution: v.object({ type: v.eq('execution'), deliveryId: idPipe, sliceId: idPipe, mode: executionModePipe }),
	'revision-execution': v.object({ type: v.eq('revision-execution'), revisionId: idPipe, actionId: idPipe }),
})
export type AgentRunPurpose = PipeOutput<typeof agentRunPurposePipe>

export const agentRunPipe = v.object({
	id: idPipe,
	agent: agentPipe,
	purpose: agentRunPurposePipe,
	started: runtimeRecordPipe,
	completed: v.nullable(runtimeRecordPipe),
})
export type AgentRun = PipeOutput<typeof agentRunPipe>

export const planningAgentRunPipe = v.object({
	id: idPipe,
	agent: agentPipe,
	purpose: planningAgentRunPurposePipe,
	started: runtimeRecordPipe,
	completed: v.nullable(runtimeRecordPipe),
})
export type PlanningAgentRun = PipeOutput<typeof planningAgentRunPipe>

const nullableFreeFormStringPipe = v.nullable(freeFormStringPipe)
const unknownPipe = v.any<unknown>()

export const agentRunTextContentPipe = v.object({ type: v.eq('text'), text: freeFormStringPipe })
export type AgentRunTextContent = PipeOutput<typeof agentRunTextContentPipe>

export const agentRunModelCostPipe = v.object({
	unit: v.eq('micro-usd'),
	input: nonNegativeIntegerPipe,
	output: nonNegativeIntegerPipe,
	cacheRead: nonNegativeIntegerPipe,
	cacheWrite: nonNegativeIntegerPipe,
	total: nonNegativeIntegerPipe,
})
export type AgentRunModelCost = PipeOutput<typeof agentRunModelCostPipe>

export const agentRunModelUsagePipe = v.object({
	inputTokens: nonNegativeIntegerPipe,
	outputTokens: nonNegativeIntegerPipe,
	cacheReadTokens: nonNegativeIntegerPipe,
	cacheWriteTokens: nonNegativeIntegerPipe,
	totalTokens: nonNegativeIntegerPipe,
	cost: v.nullable(agentRunModelCostPipe),
})
export type AgentRunModelUsage = PipeOutput<typeof agentRunModelUsagePipe>

export const agentRunModelContentPipe = v.discriminate((value) => value.type, {
	text: agentRunTextContentPipe,
	thinking: v.object({ type: v.eq('thinking'), text: freeFormStringPipe, providerReplay: v.nullable(freeFormStringPipe) }),
	'tool-call': v.object({ type: v.eq('tool-call'), toolCallId: idPipe, toolName: freeFormStringPipe, input: unknownPipe }),
})
export type AgentRunModelContent = PipeOutput<typeof agentRunModelContentPipe>

export const agentRunModelMessagePipe = v.object({
	content: v.array(agentRunModelContentPipe),
	usage: v.nullable(agentRunModelUsagePipe),
	providerResponseRef: v.nullable(freeFormStringPipe),
})
export type AgentRunModelMessage = PipeOutput<typeof agentRunModelMessagePipe>

export const agentRunModelAbortReasonPipe = v.discriminate((value) => value.type, {
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventId: idPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventId: idPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
})
export type AgentRunModelAbortReason = PipeOutput<typeof agentRunModelAbortReasonPipe>

export const agentRunModelMessageOutcomePipe = v.discriminate((value) => value.type, {
	stop: v.object({ type: v.eq('stop'), message: agentRunModelMessagePipe }),
	'tool-use': v.object({ type: v.eq('tool-use'), message: agentRunModelMessagePipe }),
	length: v.object({ type: v.eq('length'), message: agentRunModelMessagePipe, summary: nullableFreeFormStringPipe }),
	error: v.object({ type: v.eq('error'), message: v.nullable(agentRunModelMessagePipe), summary: freeFormStringPipe }),
	aborted: v.object({
		type: v.eq('aborted'),
		reason: agentRunModelAbortReasonPipe,
		message: v.nullable(agentRunModelMessagePipe),
		summary: nullableFreeFormStringPipe,
	}),
})
export type AgentRunModelMessageOutcome = PipeOutput<typeof agentRunModelMessageOutcomePipe>

export const agentRunToolTruncationPipe = v.object({
	truncated: v.boolean(),
	strategy: v.in(['head', 'tail', 'result-limit', 'line-limit']),
	originalBytes: v.nullable(nonNegativeIntegerPipe),
	originalLines: v.nullable(nonNegativeIntegerPipe),
	outputBytes: v.nullable(nonNegativeIntegerPipe),
	outputLines: v.nullable(nonNegativeIntegerPipe),
})
export type AgentRunToolTruncation = PipeOutput<typeof agentRunToolTruncationPipe>

export const agentRunToolOutputPipe = v.object({
	content: v.array(agentRunTextContentPipe),
	truncation: v.nullable(agentRunToolTruncationPipe),
})
export type AgentRunToolOutput = PipeOutput<typeof agentRunToolOutputPipe>

export const agentRunToolExecutionModePipe = v.in(['parallel-safe', 'exclusive'])
export type AgentRunToolExecutionMode = PipeOutput<typeof agentRunToolExecutionModePipe>

export const agentRunToolRefusalReasonPipe = v.discriminate((value) => value.type, {
	'unknown-tool': v.object({ type: v.eq('unknown-tool') }),
	'tool-disabled': v.object({ type: v.eq('tool-disabled') }),
	'invalid-input': v.object({ type: v.eq('invalid-input') }),
	'not-allowed-for-agent-run': v.object({ type: v.eq('not-allowed-for-agent-run') }),
	'target-closed': v.object({ type: v.eq('target-closed') }),
	'runtime-policy': v.object({ type: v.eq('runtime-policy') }),
})
export type AgentRunToolRefusalReason = PipeOutput<typeof agentRunToolRefusalReasonPipe>

export const agentRunToolCallSchedulingPipe = v.discriminate((value) => value.type, {
	accepted: v.object({ type: v.eq('accepted'), executionMode: agentRunToolExecutionModePipe }),
	refused: v.object({ type: v.eq('refused'), reason: agentRunToolRefusalReasonPipe, output: agentRunToolOutputPipe }),
})
export type AgentRunToolCallScheduling = PipeOutput<typeof agentRunToolCallSchedulingPipe>

export const agentRunToolErrorReasonPipe = v.discriminate((value) => value.type, {
	'tool-runtime-error': v.object({ type: v.eq('tool-runtime-error') }),
	'tool-timeout': v.object({ type: v.eq('tool-timeout') }),
	'sandbox-error': v.object({ type: v.eq('sandbox-error') }),
	'external-dependency-error': v.object({ type: v.eq('external-dependency-error') }),
})
export type AgentRunToolErrorReason = PipeOutput<typeof agentRunToolErrorReasonPipe>

export const agentRunToolAbortReasonPipe = v.discriminate((value) => value.type, {
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventId: idPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventId: idPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'interrupted-before-execution': v.object({ type: v.eq('interrupted-before-execution') }),
})
export type AgentRunToolAbortReason = PipeOutput<typeof agentRunToolAbortReasonPipe>

export const agentRunToolCallOutcomePipe = v.discriminate((value) => value.type, {
	success: v.object({ type: v.eq('success'), output: agentRunToolOutputPipe }),
	error: v.object({ type: v.eq('error'), reason: agentRunToolErrorReasonPipe, output: agentRunToolOutputPipe }),
	aborted: v.object({ type: v.eq('aborted'), reason: agentRunToolAbortReasonPipe, output: v.nullable(agentRunToolOutputPipe) }),
})
export type AgentRunToolCallOutcome = PipeOutput<typeof agentRunToolCallOutcomePipe>

export const agentRunInputSourcePipe = v.discriminate((value) => value.type, {
	runtime: v.object({ type: v.eq('runtime') }),
	operator: v.object({ type: v.eq('operator'), authorized: auditStampPipe }),
})
export type AgentRunInputSource = PipeOutput<typeof agentRunInputSourcePipe>

export const agentRunInterruptSourcePipe = v.discriminate((value) => value.type, {
	runtime: v.object({ type: v.eq('runtime') }),
	operator: v.object({ type: v.eq('operator'), authorized: auditStampPipe }),
})
export type AgentRunInterruptSource = PipeOutput<typeof agentRunInterruptSourcePipe>

export const agentRunCompactionSourcePipe = v.discriminate((value) => value.type, {
	runtime: v.object({ type: v.eq('runtime') }),
	operator: v.object({ type: v.eq('operator'), authorized: auditStampPipe }),
})
export type AgentRunCompactionSource = PipeOutput<typeof agentRunCompactionSourcePipe>

export const agentRunTurnStartReasonPipe = v.discriminate((value) => value.type, {
	input: v.object({ type: v.eq('input'), inputEventIds: v.array(idPipe) }),
	'tool-results': v.object({ type: v.eq('tool-results'), toolResolutionEventIds: v.array(idPipe) }),
	retry: v.object({ type: v.eq('retry'), previousTurnStartedEventId: idPipe }),
})
export type AgentRunTurnStartReason = PipeOutput<typeof agentRunTurnStartReasonPipe>

export const agentRunProposalMaterializationPipe = v.discriminate((value) => value.type, {
	'plan-output': v.object({
		type: v.eq('plan-output'),
		deliveryIds: v.array(idPipe),
		sliceIds: v.array(idPipe),
		memoryIds: v.array(idPipe),
		linkIds: v.array(idPipe),
	}),
	'revision-output': v.object({ type: v.eq('revision-output'), revisionId: idPipe }),
})
export type AgentRunProposalMaterialization = PipeOutput<typeof agentRunProposalMaterializationPipe>

export const agentRunEventBodyPipe = v.discriminate((value) => value.type, {
	'agent-run-model-selected': v.object({
		type: v.eq('agent-run-model-selected'),
		modelId: idPipe,
		thinkingLevel: modelThinkingLevelPipe,
		authorized: v.nullable(auditStampPipe),
	}),
	'input-message': v.object({ type: v.eq('input-message'), source: agentRunInputSourcePipe, content: v.array(agentRunTextContentPipe) }),
	'turn-started': v.object({
		type: v.eq('turn-started'),
		contextThroughSequence: nonNegativeIntegerPipe,
		reason: agentRunTurnStartReasonPipe,
	}),
	'turn-ended': v.object({ type: v.eq('turn-ended'), turnStartedEventId: idPipe }),
	'model-message-started': v.object({ type: v.eq('model-message-started'), turnStartedEventId: idPipe }),
	'model-message-ended': v.object({
		type: v.eq('model-message-ended'),
		modelMessageStartedEventId: idPipe,
		outcome: agentRunModelMessageOutcomePipe,
	}),
	'tool-call-scheduled': v.object({
		type: v.eq('tool-call-scheduled'),
		modelMessageEventId: idPipe,
		toolCallId: idPipe,
		toolName: freeFormStringPipe,
		input: unknownPipe,
		scheduling: agentRunToolCallSchedulingPipe,
	}),
	'tool-call-started': v.object({ type: v.eq('tool-call-started'), toolCallScheduledEventId: idPipe, toolCallId: idPipe }),
	'tool-call-ended': v.object({
		type: v.eq('tool-call-ended'),
		toolCallScheduledEventId: idPipe,
		toolCallId: idPipe,
		outcome: agentRunToolCallOutcomePipe,
	}),
	'interrupt-requested': v.object({
		type: v.eq('interrupt-requested'),
		source: agentRunInterruptSourcePipe,
		reason: nullableFreeFormStringPipe,
	}),
	'proposed-plan-output': v.object({
		type: v.eq('proposed-plan-output'),
		toolCallScheduledEventId: idPipe,
		output: planOutputProposalPipe,
	}),
	'proposed-revision-output': v.object({
		type: v.eq('proposed-revision-output'),
		toolCallScheduledEventId: idPipe,
		output: revisionOutputProposalPipe,
	}),
	'proposal-accepted': v.object({
		type: v.eq('proposal-accepted'),
		proposalEventId: idPipe,
		authorized: auditStampPipe,
		materialized: agentRunProposalMaterializationPipe,
	}),
	'proposal-rejected': v.object({
		type: v.eq('proposal-rejected'),
		proposalEventId: idPipe,
		authorized: auditStampPipe,
		reason: nullableFreeFormStringPipe,
	}),
	'context-compacted': v.object({
		type: v.eq('context-compacted'),
		source: agentRunCompactionSourcePipe,
		summary: freeFormStringPipe,
		firstKeptEventId: idPipe,
		firstKeptSequence: nonNegativeIntegerPipe,
	}),
})
export type AgentRunEventBody = PipeOutput<typeof agentRunEventBodyPipe>

export const agentRunEventPipe = v.object({
	id: idPipe,
	agentRunId: idPipe,
	sequence: nonNegativeIntegerPipe,
	occurred: runtimeRecordPipe,
	body: agentRunEventBodyPipe,
})
export type AgentRunEvent = PipeOutput<typeof agentRunEventPipe>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AgentRunEvent domain pipes', () => {
		it('accepts model selection and turn boundary events', () => {
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'agent-run-model-selected',
					modelId: 'model-1',
					thinkingLevel: 'off',
					authorized: null,
				}),
			).toMatchObject({ valid: true })
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'turn-started',
					contextThroughSequence: 2,
					reason: { type: 'input', inputEventIds: ['event-1'] },
				}),
			).toMatchObject({ valid: true })
		})
	})
}
