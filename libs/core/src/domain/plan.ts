import { v, type PipeOutput } from 'valleyed'

import { planningAgentRunPipe, type PlanningAgentRun } from './agent-run'
import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
export {
	instructionSourcePipe,
	planOutputProposalPipe,
	proposedChildMemoryCreationPipe,
	proposedDeliveryPipe,
	proposedDeliveryTargetPipe,
	proposedMemoryCreationPipe,
	proposedMemoryRevisionPipe,
	proposedSlicePipe,
} from './proposals'
export type {
	InstructionSource,
	PlanOutputProposal,
	ProposedChildMemoryCreation,
	ProposedDelivery,
	ProposedDeliveryTarget,
	ProposedMemoryCreation,
	ProposedMemoryRevision,
	ProposedSlice,
	ProposedSourceControlDeliveryTarget,
} from './proposals'

export const planPipe = v.object({
	id: idPipe,
	projectId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	created: auditStampPipe,
	closed: v.nullable(auditStampPipe),
})
export type Plan = PipeOutput<typeof planPipe>
export const planWithPlanningAgentRunPipe = v.merge(planPipe, v.object({ agentRun: planningAgentRunPipe }))
export type PlanWithPlanningAgentRun = PipeOutput<typeof planWithPlanningAgentRunPipe>

export type { PlanningAgentRun }
