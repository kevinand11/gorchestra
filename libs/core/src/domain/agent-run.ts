import { v, type PipeOutput } from 'valleyed'

import {
	agentRunBlockedPipe,
	agentRunRuntimeRequirementApplicationTargetPipe,
	agentRunRuntimeRequirementsPipe,
	agentRunSandboxConfigPipe,
} from './agent-run-runtime'
import {
	auditStampPipe,
	freeFormStringPipe,
	idPipe,
	jsonObjectPipe,
	nonEmptyTrimmedStringPipe,
	nonNegativeIntegerPipe,
	runtimeRecordPipe,
} from './commons'
import { modelUseConfigPipe } from './config'
import { modelThinkingLevelPipe } from './model'
import { modelProviderProtocolPipe } from './model-provider'
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

export const agentRunProfileSnapshotPipe = v.object({
	agentRunProfileId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	runtimeRequirements: agentRunRuntimeRequirementsPipe,
	sandboxConfig: agentRunSandboxConfigPipe,
})
export type AgentRunProfileSnapshot = PipeOutput<typeof agentRunProfileSnapshotPipe>

export const agentRunModelUseOverridePipe = v.object({ modelUse: modelUseConfigPipe, selected: auditStampPipe })
export type AgentRunModelUseOverride = PipeOutput<typeof agentRunModelUseOverridePipe>

const nullableFreeFormStringPipe = v.nullable(freeFormStringPipe)
const unknownPipe = v.any<unknown>()
const toolCallIdPipe = nonEmptyTrimmedStringPipe

export const agentRunRuntimeRequirementOverridePipe = v.object({
	requirements: agentRunRuntimeRequirementsPipe,
	added: auditStampPipe,
	eventId: idPipe,
})
export type AgentRunRuntimeRequirementOverride = PipeOutput<typeof agentRunRuntimeRequirementOverridePipe>

export const agentRunSandboxStatePipe = v.object({
	key: nonEmptyTrimmedStringPipe,
	created: v.nullable(runtimeRecordPipe),
	appliedRequirements: agentRunRuntimeRequirementsPipe,
	appliedThroughEventId: v.nullable(idPipe),
	released: v.nullable(runtimeRecordPipe),
})
export type AgentRunSandboxState = PipeOutput<typeof agentRunSandboxStatePipe>

export const agentRunPipe = v.object({
	id: idPipe,
	agent: agentPipe,
	purpose: agentRunPurposePipe,
	profile: agentRunProfileSnapshotPipe,
	modelUseOverride: v.nullable(agentRunModelUseOverridePipe),
	sourceRuntimeRequirements: agentRunRuntimeRequirementsPipe,
	runtimeRequirementOverrides: v.array(agentRunRuntimeRequirementOverridePipe),
	desiredRuntimeRequirements: agentRunRuntimeRequirementsPipe,
	blocked: agentRunBlockedPipe,
	sandbox: agentRunSandboxStatePipe,
	started: runtimeRecordPipe,
	completed: v.nullable(runtimeRecordPipe),
})
export type AgentRun = PipeOutput<typeof agentRunPipe>

export const planningAgentRunPipe = v.object({
	id: idPipe,
	agent: agentPipe,
	purpose: planningAgentRunPurposePipe,
	profile: agentRunProfileSnapshotPipe,
	modelUseOverride: v.nullable(agentRunModelUseOverridePipe),
	sourceRuntimeRequirements: agentRunRuntimeRequirementsPipe,
	runtimeRequirementOverrides: v.array(agentRunRuntimeRequirementOverridePipe),
	desiredRuntimeRequirements: agentRunRuntimeRequirementsPipe,
	blocked: agentRunBlockedPipe,
	sandbox: agentRunSandboxStatePipe,
	started: runtimeRecordPipe,
	completed: v.nullable(runtimeRecordPipe),
})
export type PlanningAgentRun = PipeOutput<typeof planningAgentRunPipe>

export const agentRunTranscriptPartMetadataPipe = v.nullable(jsonObjectPipe)
export type AgentRunTranscriptPartMetadata = PipeOutput<typeof agentRunTranscriptPartMetadataPipe>

export const agentRunTextTranscriptPartPipe = v.object({
	type: v.eq('text'),
	text: freeFormStringPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunTextTranscriptPart = PipeOutput<typeof agentRunTextTranscriptPartPipe>

export const agentRunTextContentPipe = agentRunTextTranscriptPartPipe
export type AgentRunTextContent = AgentRunTextTranscriptPart

export const agentRunInstructionPipe = v.discriminate((value) => value.type, {
	'source-control-planning': v.object({
		type: v.eq('source-control-planning'),
		version: v.eq(1),
	}),
	'source-control-revision-planning': v.object({
		type: v.eq('source-control-revision-planning'),
		version: v.eq(1),
	}),
	'source-control-slice-execution': v.object({
		type: v.eq('source-control-slice-execution'),
		version: v.eq(1),
	}),
})
export type AgentRunInstruction = PipeOutput<typeof agentRunInstructionPipe>

const fileDataPipe = v.discriminate((value) => value.type, {
	data: v.object({ type: v.eq('data'), data: freeFormStringPipe }),
	url: v.object({ type: v.eq('url'), url: nonEmptyTrimmedStringPipe }),
	reference: v.object({ type: v.eq('reference'), reference: v.record(nonEmptyTrimmedStringPipe, nonEmptyTrimmedStringPipe) }),
	text: v.object({ type: v.eq('text'), text: freeFormStringPipe }),
})

const reasoningFileDataPipe = v.discriminate((value) => value.type, {
	data: v.object({ type: v.eq('data'), data: freeFormStringPipe }),
	url: v.object({ type: v.eq('url'), url: nonEmptyTrimmedStringPipe }),
})

export const agentRunFileTranscriptPartPipe = v.object({
	type: v.eq('file'),
	data: fileDataPipe,
	mediaType: nonEmptyTrimmedStringPipe,
	filename: v.nullable(nonEmptyTrimmedStringPipe),
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunFileTranscriptPart = PipeOutput<typeof agentRunFileTranscriptPartPipe>

export const agentRunReasoningTranscriptPartPipe = v.object({
	type: v.eq('reasoning'),
	text: freeFormStringPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunReasoningTranscriptPart = PipeOutput<typeof agentRunReasoningTranscriptPartPipe>

export const agentRunReasoningFileTranscriptPartPipe = v.object({
	type: v.eq('reasoning-file'),
	data: reasoningFileDataPipe,
	mediaType: nonEmptyTrimmedStringPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunReasoningFileTranscriptPart = PipeOutput<typeof agentRunReasoningFileTranscriptPartPipe>

export const agentRunSourceTranscriptPartPipe = v.object({
	type: v.eq('source'),
	sourceType: nonEmptyTrimmedStringPipe,
	id: nonEmptyTrimmedStringPipe,
	title: v.nullable(nonEmptyTrimmedStringPipe),
	url: v.nullable(nonEmptyTrimmedStringPipe),
	mediaType: v.nullable(nonEmptyTrimmedStringPipe),
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunSourceTranscriptPart = PipeOutput<typeof agentRunSourceTranscriptPartPipe>

export const agentRunCustomTranscriptPartPipe = v.object({
	type: v.eq('custom'),
	kind: nonEmptyTrimmedStringPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})
export type AgentRunCustomTranscriptPart = PipeOutput<typeof agentRunCustomTranscriptPartPipe>

export const agentRunToolResultOutputPipe = v.discriminate((value) => value.type, {
	text: v.object({ type: v.eq('text'), value: freeFormStringPipe }),
	json: v.object({ type: v.eq('json'), value: unknownPipe }),
	'error-text': v.object({ type: v.eq('error-text'), value: freeFormStringPipe }),
	'execution-denied': v.object({ type: v.eq('execution-denied'), reason: v.nullable(freeFormStringPipe) }),
})
export type AgentRunToolResultOutput = PipeOutput<typeof agentRunToolResultOutputPipe>

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
	output: agentRunToolResultOutputPipe,
	truncation: v.nullable(agentRunToolTruncationPipe),
})
export type AgentRunToolOutput = PipeOutput<typeof agentRunToolOutputPipe>

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

export const turnErrorReasonPipe = v.discriminate((value) => value.type, {
	...runtimeErrorReasonPipes,
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventId: idPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventId: idPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'abort-signal': v.object({ type: v.eq('abort-signal') }),
})
export type TurnErrorReason = PipeOutput<typeof turnErrorReasonPipe>

export const agentRunToolErrorReasonPipe = v.discriminate((value) => value.type, {
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
	'operator-interrupt': v.object({ type: v.eq('operator-interrupt'), interruptEventId: idPipe }),
	'runtime-interrupt': v.object({ type: v.eq('runtime-interrupt'), interruptEventId: idPipe }),
	timeout: v.object({ type: v.eq('timeout') }),
	'abort-signal': v.object({ type: v.eq('abort-signal') }),
	'interrupted-before-execution': v.object({ type: v.eq('interrupted-before-execution') }),
	'result-not-recorded-before-recovery': v.object({ type: v.eq('result-not-recorded-before-recovery') }),
})
export type AgentRunToolErrorReason = PipeOutput<typeof agentRunToolErrorReasonPipe>

const agentRunToolCallTranscriptPartPipe = v.object({
	type: v.eq('tool-call'),
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	input: unknownPipe,
	providerExecuted: v.boolean(),
	metadata: agentRunTranscriptPartMetadataPipe,
})

const providerExecutedToolResultPartPipe = v.object({
	type: v.eq('tool-result'),
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	providerExecuted: v.eq(true),
	output: agentRunToolResultOutputPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})

const coreExecutedToolResultPartPipe = v.object({
	type: v.eq('tool-result'),
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	providerExecuted: v.eq(false),
	started: runtimeRecordPipe,
	completed: runtimeRecordPipe,
	output: agentRunToolResultOutputPipe,
	truncation: v.nullable(agentRunToolTruncationPipe),
	metadata: agentRunTranscriptPartMetadataPipe,
})

const providerExecutedToolErrorPartPipe = v.object({
	type: v.eq('tool-error'),
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	providerExecuted: v.eq(true),
	error: unknownPipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})

const coreExecutedToolErrorPartPipe = v.object({
	type: v.eq('tool-error'),
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	providerExecuted: v.eq(false),
	started: runtimeRecordPipe,
	completed: runtimeRecordPipe,
	reason: agentRunToolErrorReasonPipe,
	error: agentRunToolResultOutputPipe,
	truncation: v.nullable(agentRunToolTruncationPipe),
	metadata: agentRunTranscriptPartMetadataPipe,
})

const agentRunToolApprovalRequestPartPipe = v.object({
	type: v.eq('tool-approval-request'),
	approvalId: nonEmptyTrimmedStringPipe,
	toolCallId: toolCallIdPipe,
	toolName: freeFormStringPipe,
	providerExecuted: v.boolean(),
	metadata: agentRunTranscriptPartMetadataPipe,
})

const agentRunToolApprovalResponseSourcePipe = v.discriminate((value) => value.type, {
	runtime: v.object({ type: v.eq('runtime') }),
	operator: v.object({ type: v.eq('operator'), authorized: auditStampPipe }),
})

const agentRunToolApprovalResponsePartPipe = v.object({
	type: v.eq('tool-approval-response'),
	approvalId: nonEmptyTrimmedStringPipe,
	approved: v.boolean(),
	reason: v.nullable(freeFormStringPipe),
	providerExecuted: v.boolean(),
	source: agentRunToolApprovalResponseSourcePipe,
	metadata: agentRunTranscriptPartMetadataPipe,
})

export const agentRunSystemTranscriptPartPipe = agentRunTextTranscriptPartPipe
export type AgentRunSystemTranscriptPart = PipeOutput<typeof agentRunSystemTranscriptPartPipe>
export const agentRunSystemTranscriptPartsPipe = v.array(agentRunSystemTranscriptPartPipe).pipe(v.min(1))

export const agentRunInputTranscriptPartPipe = agentRunTextTranscriptPartPipe
export type AgentRunInputTranscriptPart = PipeOutput<typeof agentRunInputTranscriptPartPipe>
export const agentRunInputTranscriptPartsPipe = v.array(agentRunInputTranscriptPartPipe).pipe(v.min(1))

export const agentRunAssistantTranscriptPartPipe = v.discriminate((value) => value.type, {
	text: agentRunTextTranscriptPartPipe,
	reasoning: agentRunReasoningTranscriptPartPipe,
	'reasoning-file': agentRunReasoningFileTranscriptPartPipe,
	source: agentRunSourceTranscriptPartPipe,
	file: agentRunFileTranscriptPartPipe,
	custom: agentRunCustomTranscriptPartPipe,
	'tool-call': agentRunToolCallTranscriptPartPipe,
	'tool-result': providerExecutedToolResultPartPipe,
	'tool-error': providerExecutedToolErrorPartPipe,
	'tool-approval-request': agentRunToolApprovalRequestPartPipe,
})
export type AgentRunAssistantTranscriptPart = PipeOutput<typeof agentRunAssistantTranscriptPartPipe>
export const agentRunAssistantTranscriptPartsPipe = v.array(agentRunAssistantTranscriptPartPipe)

export const agentRunToolTranscriptPartPipe = v.discriminate((value) => value.type, {
	'tool-result': coreExecutedToolResultPartPipe,
	'tool-error': coreExecutedToolErrorPartPipe,
	'tool-approval-response': agentRunToolApprovalResponsePartPipe,
})
export type AgentRunToolTranscriptPart = PipeOutput<typeof agentRunToolTranscriptPartPipe>
export const agentRunToolTranscriptPartsPipe = v.array(agentRunToolTranscriptPartPipe).pipe(v.min(1))

export const agentRunLanguageModelUsagePipe = v.object({
	inputTokens: v.nullable(nonNegativeIntegerPipe),
	inputTokenDetails: v.object({
		noCacheTokens: v.nullable(nonNegativeIntegerPipe),
		cacheReadTokens: v.nullable(nonNegativeIntegerPipe),
		cacheWriteTokens: v.nullable(nonNegativeIntegerPipe),
	}),
	outputTokens: v.nullable(nonNegativeIntegerPipe),
	outputTokenDetails: v.object({
		textTokens: v.nullable(nonNegativeIntegerPipe),
		reasoningTokens: v.nullable(nonNegativeIntegerPipe),
	}),
})
export type AgentRunLanguageModelUsage = PipeOutput<typeof agentRunLanguageModelUsagePipe>

export const agentRunModelCostPipe = v.object({
	unit: v.eq('micro-usd'),
	input: nonNegativeIntegerPipe,
	output: nonNegativeIntegerPipe,
	cacheRead: nonNegativeIntegerPipe,
	cacheWrite: nonNegativeIntegerPipe,
})
export type AgentRunModelCost = PipeOutput<typeof agentRunModelCostPipe>

const agentRunAssistantMessageModelPipe = v.object({
	modelId: idPipe,
	thinkingLevel: modelThinkingLevelPipe,
	modelProviderId: idPipe,
	providerProtocol: modelProviderProtocolPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
})

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
	input: v.object({ type: v.eq('input'), inputEventIds: v.array(idPipe).pipe(v.min(1)) }),
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
	'agent-run-model-use-override-changed': v.object({
		type: v.eq('agent-run-model-use-override-changed'),
		modelUse: v.nullable(modelUseConfigPipe),
		authorized: auditStampPipe,
	}),
	'agent-run-runtime-requirement-override-added': v.object({
		type: v.eq('agent-run-runtime-requirement-override-added'),
		requirements: agentRunRuntimeRequirementsPipe,
		authorized: auditStampPipe,
	}),
	'agent-run-sandbox-created': v.object({
		type: v.eq('agent-run-sandbox-created'),
		key: nonEmptyTrimmedStringPipe,
	}),
	'agent-run-sandbox-preparation-started': v.object({
		type: v.eq('agent-run-sandbox-preparation-started'),
		requestedThroughEventId: v.nullable(idPipe),
	}),
	'agent-run-sandbox-preparation-completed': v.object({
		type: v.eq('agent-run-sandbox-preparation-completed'),
		appliedThroughEventId: v.nullable(idPipe),
		summary: freeFormStringPipe,
	}),
	'agent-run-sandbox-preparation-failed': v.object({
		type: v.eq('agent-run-sandbox-preparation-failed'),
		target: agentRunRuntimeRequirementApplicationTargetPipe,
		summary: freeFormStringPipe,
	}),
	'agent-run-sandbox-release-completed': v.object({
		type: v.eq('agent-run-sandbox-release-completed'),
		summary: freeFormStringPipe,
	}),
	'agent-run-sandbox-release-failed': v.object({
		type: v.eq('agent-run-sandbox-release-failed'),
		summary: freeFormStringPipe,
	}),
	'instruction-snapshot': v.object({
		type: v.eq('instruction-snapshot'),
		instruction: agentRunInstructionPipe,
		parts: agentRunSystemTranscriptPartsPipe,
	}),
	'input-message': v.object({ type: v.eq('input-message'), source: agentRunInputSourcePipe, parts: agentRunInputTranscriptPartsPipe }),
	'turn-started': v.object({
		type: v.eq('turn-started'),
		contextThroughEventId: idPipe,
		reason: agentRunTurnStartReasonPipe,
	}),
	'turn-ended': v.object({
		type: v.eq('turn-ended'),
		turnStartedEventId: idPipe,
		outcome: v.discriminate((outcome) => outcome.type, {
			completed: v.object({ type: v.eq('completed') }),
			error: v.object({ type: v.eq('error'), reason: turnErrorReasonPipe }),
		}),
	}),
	'assistant-message': v.object({
		type: v.eq('assistant-message'),
		turnStartedEventId: idPipe,
		model: agentRunAssistantMessageModelPipe,
		finishReason: v.in(['stop', 'tool-calls', 'length', 'content-filter', 'error', 'other']),
		usage: agentRunLanguageModelUsagePipe,
		cost: v.nullable(agentRunModelCostPipe),
		responseId: v.nullable(freeFormStringPipe),
		parts: agentRunAssistantTranscriptPartsPipe,
	}),
	'tool-message': v.object({
		type: v.eq('tool-message'),
		turnStartedEventId: idPipe,
		respondsToAssistantMessageEventId: idPipe,
		source: v.discriminate((value) => value.type, {
			'tool-execution': v.object({ type: v.eq('tool-execution') }),
			'runtime-recovery': v.object({ type: v.eq('runtime-recovery') }),
		}),
		parts: agentRunToolTranscriptPartsPipe,
	}),
	'interrupt-requested': v.object({
		type: v.eq('interrupt-requested'),
		source: agentRunInterruptSourcePipe,
		reason: nullableFreeFormStringPipe,
	}),
	'proposed-plan-output': v.object({
		type: v.eq('proposed-plan-output'),
		assistantMessageEventId: idPipe,
		toolCallId: toolCallIdPipe,
		output: planOutputProposalPipe,
	}),
	'proposed-revision-output': v.object({
		type: v.eq('proposed-revision-output'),
		assistantMessageEventId: idPipe,
		toolCallId: toolCallIdPipe,
		output: revisionOutputProposalPipe,
	}),
	'proposal-accepted': v.object({
		type: v.eq('proposal-accepted'),
		proposalEventId: idPipe,
		authorized: auditStampPipe,
		materialized: agentRunProposalMaterializationPipe,
		projectedParts: agentRunSystemTranscriptPartsPipe,
	}),
	'proposal-rejected': v.object({
		type: v.eq('proposal-rejected'),
		proposalEventId: idPipe,
		authorized: auditStampPipe,
		reason: nullableFreeFormStringPipe,
		projectedParts: agentRunSystemTranscriptPartsPipe,
	}),
	'context-compacted': v.object({
		type: v.eq('context-compacted'),
		source: agentRunCompactionSourcePipe,
		compactedThroughEventId: idPipe,
		replacementParts: agentRunSystemTranscriptPartsPipe,
	}),
})
export type AgentRunEventBody = PipeOutput<typeof agentRunEventBodyPipe>

export const agentRunEventPipe = v.object({
	id: idPipe,
	agentRunId: idPipe,
	occurred: runtimeRecordPipe,
	body: agentRunEventBodyPipe,
})
export type AgentRunEvent = PipeOutput<typeof agentRunEventPipe>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('AgentRunEvent domain pipes', () => {
		it('accepts model-use override and turn boundary events', () => {
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'agent-run-model-use-override-changed',
					modelUse: { modelId: '01k00000000000000000000024', thinkingLevel: 'none' },
					authorized: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				}),
			).toMatchObject({ valid: true })
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'turn-started',
					contextThroughEventId: '01j00000000000000000000001',
					reason: { type: 'input', inputEventIds: ['01j00000000000000000000002'] },
				}),
			).toMatchObject({ valid: true })
		})

		it('accepts new transcript event variants with required metadata and links', () => {
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'input-message',
					source: { type: 'runtime' },
					parts: [{ type: 'text', text: 'Hello', metadata: null }],
				}),
			).toMatchObject({ valid: true })
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'assistant-message',
					turnStartedEventId: '01j00000000000000000000001',
					model: {
						modelId: '01k00000000000000000000024',
						thinkingLevel: 'none',
						modelProviderId: '01k00000000000000000000032',
						providerProtocol: 'anthropic-messages',
						providerModelId: 'claude-sonnet',
					},
					finishReason: 'tool-calls',
					usage: {
						inputTokens: 10,
						inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: null, cacheWriteTokens: null },
						outputTokens: 5,
						outputTokenDetails: { textTokens: 4, reasoningTokens: 1 },
					},
					cost: null,
					responseId: 'response-1',
					parts: [
						{ type: 'reasoning', text: 'thinking', metadata: null },
						{ type: 'text', text: 'I will call a tool.', metadata: null },
						{
							type: 'tool-call',
							toolCallId: 'call-1',
							toolName: 'propose-plan-output',
							input: {},
							providerExecuted: false,
							metadata: null,
						},
					],
				}),
			).toMatchObject({ valid: true })
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'tool-message',
					turnStartedEventId: '01j00000000000000000000001',
					respondsToAssistantMessageEventId: '01j00000000000000000000002',
					source: { type: 'tool-execution' },
					parts: [
						{
							type: 'tool-result',
							toolCallId: 'call-1',
							toolName: 'read',
							providerExecuted: false,
							started: { at: '2026-06-10T12:00:00.000Z' },
							completed: { at: '2026-06-10T12:00:01.000Z' },
							output: { type: 'text', value: 'done' },
							truncation: null,
							metadata: null,
						},
					],
				}),
			).toMatchObject({ valid: true })
		})

		it('rejects removed low-level model and tool event bodies', () => {
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'model-message-started',
					turnStartedEventId: '01j00000000000000000000001',
					aiSdkCallId: null,
				}),
			).toMatchObject({ valid: false })
			expect(
				v.validate(agentRunEventBodyPipe, {
					type: 'tool-call-started',
					modelMessageCursor: '01j00000000000000000000001',
					toolCallId: 'call-1',
					toolName: 'tool',
					input: {},
				}),
			).toMatchObject({ valid: false })
		})

		it('rejects non-lowercase Core ids', () => {
			expect(v.assert(idPipe, '01j00000000000000000000001')).toBe('01j00000000000000000000001')
		})
	})
}
