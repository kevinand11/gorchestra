import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'
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

export const planSchema = coreSchema('plans')
	.field('projectId', idPipe)
	.field('agentRunId', idPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('created', auditStampPipe)
	.field('closed', v.nullable(auditStampPipe))
	.build()
export const planPipe = schemaToPipe(planSchema)
export type Plan = PipeOutput<typeof planPipe>
