import { v, type PipeOutput } from 'valleyed'

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
	agentRunId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	created: auditStampPipe,
	closed: v.nullable(auditStampPipe),
})
export type Plan = PipeOutput<typeof planPipe>
