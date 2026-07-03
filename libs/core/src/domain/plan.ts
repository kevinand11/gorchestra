import { v, type PipeOutput } from 'valleyed'

import { planningAgentRunPipe, type PlanningAgentRun } from './agent-run'
import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { planConfigRecordPipe, type PlanConfig, type PlanConfigRecord } from './config'
export {
	instructionSourcePipe,
	planOutputProposalPipe,
	proposedDeliveryPipe,
	proposedDeliveryTargetPipe,
	proposedGraphRefPipe,
	proposedMemoryLinkPipe,
	proposedMemoryPipe,
	proposedSlicePipe,
} from './proposals'
export type {
	InstructionSource,
	PlanOutputProposal,
	ProposedDelivery,
	ProposedDeliveryTarget,
	ProposedGraphRef,
	ProposedMemory,
	ProposedMemoryLink,
	ProposedSlice,
	ProposedSourceControlDeliveryTarget,
} from './proposals'

export const planPipe = v.object({
	id: idPipe,
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	config: v.nullable(planConfigRecordPipe),
	created: auditStampPipe,
	closed: v.nullable(auditStampPipe),
})
export type Plan = PipeOutput<typeof planPipe>
export const planWithPlanningAgentRunPipe = v.merge(planPipe, v.object({ agentRun: planningAgentRunPipe }))
export type PlanWithPlanningAgentRun = PipeOutput<typeof planWithPlanningAgentRunPipe>

export type { PlanningAgentRun }

export type { PlanConfig, PlanConfigRecord }
