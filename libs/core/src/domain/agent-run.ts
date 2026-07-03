import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, runtimeRecordPipe } from './commons'
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
const toolCallIdPipe = nonEmptyTrimmedStringPipe

export const agentRunEventCursorPipe = nonEmptyTrimmedStringPipe
	.pipe((value) => value.toUpperCase())
	.pipe(v.custom((value) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value), 'Expected an Agent Run Event cursor.'))
export type AgentRunEventCursor = PipeOutput<typeof agentRunEventCursorPipe>

export const agentRunTextContentPipe = v.object({ type: v.eq('text'), text: freeFormStringPipe })
export type AgentRunTextContent = PipeOutput<typeof agentRunTextContentPipe>

export const agentRunInstructionPipe = v.discriminate((value) => value.type, {
	'source-control-planning': v.object({
		type: v.eq('source-control-planning'),
		version: v.eq(1),
		content: v.array(agentRunTextContentPipe),
	}),
})
export type AgentRunInstruction = PipeOutput<typeof agentRunInstructionPipe>

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
	'tool-call': v.object({ type: v.eq('tool-call'), toolCallId: toolCallIdPipe, toolName: freeFormStringPipe, input: unknownPipe }),
})
export type AgentRunModelContent = PipeOutput<typeof agentRunModelContentPipe>

export const agentRunModelMessagePipe = v.object({
	content: v.array(agentRunModelContentPipe),
	usage: v.nullable(agentRunModelUsagePipe),
	providerResponseRef: v.nullable(freeFormStringPipe),
})
export type AgentRunModelMessage = PipeOutput<typeof agentRunModelMessagePipe>

const providerGenerationFailureReasonPipes = {
	'provider-authentication-failed': v.object({ type: v.eq('provider-authentication-failed') }),
	'provider-access-denied': v.object({ type: v.eq('provider-access-denied') }),
	'provider-model-not-found': v.object({ type: v.eq('provider-model-not-found') }),
	'provider-rate-limited': v.object({ type: v.eq('provider-rate-limited') }),
	'provider-content-filtered': v.object({ type: v.eq('provider-content-filtered') }),
	'provider-unavailable': v.object({ type: v.eq('provider-unavailable') }),
	'provider-generation-failed': v.object({ type: v.eq('provider-generation-failed') }),
}

export const modelProviderGenerationFailureReasonPipe = v.discriminate((value) => value.type, providerGenerationFailureReasonPipes)
export type ModelProviderGenerationFailureReason = PipeOutput<typeof modelProviderGenerationFailureReasonPipe>

const runtimeErrorReasonPipes = {
	...providerGenerationFailureReasonPipes,
	'runtime-error': v.object({ type: v.eq('runtime-error') }),
}

export const turnErrorReasonPipe = v.discriminate((value) => value.type, runtimeErrorReasonPipes)
export type TurnErrorReason = PipeOutput<typeof turnErrorReasonPipe>

export const turnAbortReasonPipe = v.discriminate((value) => value.type, {
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'abort-signal': v.object({ type: v.eq('abort-signal') }),
})
export type TurnAbortReason = PipeOutput<typeof turnAbortReasonPipe>

export const modelMessageErrorReasonPipe = v.discriminate((value) => value.type, runtimeErrorReasonPipes)
export type ModelMessageErrorReason = PipeOutput<typeof modelMessageErrorReasonPipe>

export const agentRunModelAbortReasonPipe = v.discriminate((value) => value.type, {
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'abort-signal': v.object({ type: v.eq('abort-signal') }),
})
export type AgentRunModelAbortReason = PipeOutput<typeof agentRunModelAbortReasonPipe>

export const agentRunModelMessageOutcomePipe = v.discriminate((value) => value.type, {
	stop: v.object({ type: v.eq('stop'), message: agentRunModelMessagePipe }),
	'tool-calls': v.object({ type: v.eq('tool-calls'), message: agentRunModelMessagePipe }),
	length: v.object({ type: v.eq('length'), message: agentRunModelMessagePipe, summary: nullableFreeFormStringPipe }),
	error: v.object({
		type: v.eq('error'),
		reason: modelMessageErrorReasonPipe,
		message: v.nullable(agentRunModelMessagePipe),
		summary: freeFormStringPipe,
	}),
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

export const agentRunToolCallErrorReasonPipe = v.discriminate((value) => value.type, {
	'unknown-tool': v.object({ type: v.eq('unknown-tool') }),
	'tool-disabled': v.object({ type: v.eq('tool-disabled') }),
	'invalid-input': v.object({ type: v.eq('invalid-input') }),
	'not-allowed-for-agent-run': v.object({ type: v.eq('not-allowed-for-agent-run') }),
	'target-closed': v.object({ type: v.eq('target-closed') }),
	'runtime-policy': v.object({ type: v.eq('runtime-policy') }),
	'tool-runtime-error': v.object({ type: v.eq('tool-runtime-error') }),
	'tool-timeout': v.object({ type: v.eq('tool-timeout') }),
	'sandbox-error': v.object({ type: v.eq('sandbox-error') }),
	'external-dependency-error': v.object({ type: v.eq('external-dependency-error') }),
})
export type AgentRunToolCallErrorReason = PipeOutput<typeof agentRunToolCallErrorReasonPipe>

export const agentRunToolAbortReasonPipe = v.discriminate((value) => value.type, {
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventCursor: agentRunEventCursorPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'abort-signal': v.object({ type: v.eq('abort-signal') }),
	'interrupted-before-execution': v.object({ type: v.eq('interrupted-before-execution') }),
})
export type AgentRunToolAbortReason = PipeOutput<typeof agentRunToolAbortReasonPipe>

export const agentRunToolCallOutcomePipe = v.discriminate((value) => value.type, {
	success: v.object({ type: v.eq('success'), output: agentRunToolOutputPipe }),
	error: v.object({ type: v.eq('error'), reason: agentRunToolCallErrorReasonPipe, output: agentRunToolOutputPipe }),
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
	input: v.object({ type: v.eq('input'), inputEventCursors: v.array(agentRunEventCursorPipe) }),
	retry: v.object({ type: v.eq('retry'), previousTurnStartedCursor: agentRunEventCursorPipe }),
})
export type AgentRunTurnStartReason = PipeOutput<typeof agentRunTurnStartReasonPipe>

export const agentRunProposalMaterializationPipe = v.discriminate((value) => value.type, {
	'plan-output': v.object({
		type: v.eq('plan-output'),
		deliveryIds: v.array(idPipe),
		sliceIds: v.array(idPipe),
		memoryIds: v.array(idPipe),
		memoryRevisionIds: v.array(idPipe),
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
	'instruction-snapshot': v.object({ type: v.eq('instruction-snapshot'), instruction: agentRunInstructionPipe }),
	'input-message': v.object({ type: v.eq('input-message'), source: agentRunInputSourcePipe, content: v.array(agentRunTextContentPipe) }),
	'turn-started': v.object({
		type: v.eq('turn-started'),
		contextThroughCursor: v.nullable(agentRunEventCursorPipe),
		reason: agentRunTurnStartReasonPipe,
	}),
	'turn-ended': v.object({
		type: v.eq('turn-ended'),
		turnStartedCursor: agentRunEventCursorPipe,
		outcome: v.discriminate((outcome) => outcome.type, {
			completed: v.object({ type: v.eq('completed') }),
			error: v.object({ type: v.eq('error'), reason: turnErrorReasonPipe, summary: freeFormStringPipe }),
			aborted: v.object({ type: v.eq('aborted'), reason: turnAbortReasonPipe, summary: nullableFreeFormStringPipe }),
		}),
	}),
	'model-message-started': v.object({
		type: v.eq('model-message-started'),
		turnStartedCursor: agentRunEventCursorPipe,
		aiSdkCallId: v.nullable(freeFormStringPipe),
	}),
	'model-message-ended': v.object({
		type: v.eq('model-message-ended'),
		modelMessageStartedCursor: agentRunEventCursorPipe,
		outcome: agentRunModelMessageOutcomePipe,
	}),
	'tool-call-started': v.object({
		type: v.eq('tool-call-started'),
		modelMessageCursor: agentRunEventCursorPipe,
		toolCallId: toolCallIdPipe,
		toolName: freeFormStringPipe,
		input: unknownPipe,
	}),
	'tool-call-ended': v.object({
		type: v.eq('tool-call-ended'),
		toolCallStartedCursor: agentRunEventCursorPipe,
		outcome: agentRunToolCallOutcomePipe,
	}),
	'interrupt-requested': v.object({
		type: v.eq('interrupt-requested'),
		source: agentRunInterruptSourcePipe,
		reason: nullableFreeFormStringPipe,
	}),
	'proposed-plan-output': v.object({
		type: v.eq('proposed-plan-output'),
		toolCallStartedCursor: agentRunEventCursorPipe,
		output: planOutputProposalPipe,
	}),
	'proposed-revision-output': v.object({
		type: v.eq('proposed-revision-output'),
		toolCallStartedCursor: agentRunEventCursorPipe,
		output: revisionOutputProposalPipe,
	}),
	'proposal-accepted': v.object({
		type: v.eq('proposal-accepted'),
		proposalCursor: agentRunEventCursorPipe,
		authorized: auditStampPipe,
		materialized: agentRunProposalMaterializationPipe,
	}),
	'proposal-rejected': v.object({
		type: v.eq('proposal-rejected'),
		proposalCursor: agentRunEventCursorPipe,
		authorized: auditStampPipe,
		reason: nullableFreeFormStringPipe,
	}),
	'context-compacted': v.object({
		type: v.eq('context-compacted'),
		source: agentRunCompactionSourcePipe,
		summary: freeFormStringPipe,
		firstKeptCursor: agentRunEventCursorPipe,
	}),
})
export type AgentRunEventBody = PipeOutput<typeof agentRunEventBodyPipe>

export const agentRunEventPipe = v.object({
	id: idPipe,
	agentRunId: idPipe,
	cursor: agentRunEventCursorPipe,
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
					contextThroughCursor: '01J00000000000000000000001',
					reason: { type: 'input', inputEventCursors: ['01J00000000000000000000002'] },
				}),
			).toMatchObject({ valid: true })
		})

		it('normalizes cursors to uppercase ULIDs', () => {
			expect(v.assert(agentRunEventCursorPipe, '01j00000000000000000000001')).toBe('01J00000000000000000000001')
		})
	})
}
