import { v, type PipeOutput } from 'valleyed'

import { idPipe, runtimeRecordPipe } from './commons'

export const agentPipe = v.discriminate((value) => value.type, {
	model: v.object({ type: v.eq('model'), modelId: idPipe }),
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
