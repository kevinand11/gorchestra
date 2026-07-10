import { v, type PipeOutput } from 'valleyed'

import { agentRunBlockedPipe, agentRunRuntimeRequirementsPipe, agentRunSandboxConfigPipe } from './agent-run-runtime'
import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe, positiveIntegerPipe, runtimeRecordPipe } from './commons'
import { modelUseConfigPipe } from './config'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

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

export const agentRunToolSetEntryPipe = v.object({ name: nonEmptyTrimmedStringPipe, contractVersion: positiveIntegerPipe })
export type AgentRunToolSetEntry = PipeOutput<typeof agentRunToolSetEntryPipe>

export const agentRunToolSetPipe = v
	.array(agentRunToolSetEntryPipe)
	.pipe(
		v.custom((entries) => entries.length === new Set(entries.map((entry) => entry.name)).size, 'Expected unique Agent Run Tool names.'),
	)
export type AgentRunToolSet = PipeOutput<typeof agentRunToolSetPipe>

export const agentRunModelUseOverridePipe = v.object({ modelUse: modelUseConfigPipe, selected: auditStampPipe })
export type AgentRunModelUseOverride = PipeOutput<typeof agentRunModelUseOverridePipe>

export const agentRunRuntimeRequirementOverridePipe = v.object({
	requirements: agentRunRuntimeRequirementsPipe,
	added: auditStampPipe,
	eventId: idPipe,
})
export type AgentRunRuntimeRequirementOverride = PipeOutput<typeof agentRunRuntimeRequirementOverridePipe>

export const agentRunSandboxStatePipe = v.nullable(
	v.object({
		key: nonEmptyTrimmedStringPipe,
		created: runtimeRecordPipe,
		appliedRequirements: agentRunRuntimeRequirementsPipe,
		appliedThroughEventId: v.nullable(idPipe),
		released: v.nullable(runtimeRecordPipe),
	}),
)
export type AgentRunSandboxState = PipeOutput<typeof agentRunSandboxStatePipe>

export const agentRunSchema = coreSchema('agent_runs')
	.field('agent', agentPipe)
	.field('purpose', agentRunPurposePipe)
	.field('profile', agentRunProfileSnapshotPipe)
	.field('toolSet', agentRunToolSetPipe)
	.field('modelUseOverride', v.nullable(agentRunModelUseOverridePipe))
	.field('sourceRuntimeRequirements', agentRunRuntimeRequirementsPipe)
	.field('runtimeRequirementOverrides', v.array(agentRunRuntimeRequirementOverridePipe))
	.field('desiredRuntimeRequirements', agentRunRuntimeRequirementsPipe)
	.field('blocked', agentRunBlockedPipe)
	.field('sandbox', agentRunSandboxStatePipe)
	.field('started', runtimeRecordPipe)
	.field('completed', v.nullable(runtimeRecordPipe))
	.build()
export const agentRunPipe = schemaToPipe(agentRunSchema)
export type AgentRun = PipeOutput<typeof agentRunPipe>
