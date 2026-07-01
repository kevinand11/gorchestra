import { v, type PipeOutput } from 'valleyed'

import { freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { graphNodeRefPipe } from './graph'

export const instructionSourcePipe = v.object({ body: freeFormStringPipe })
export type InstructionSource = PipeOutput<typeof instructionSourcePipe>

export const proposedDeliveryTargetPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({
		type: v.eq('source-control'),
		repositoryId: idPipe,
		targetBranch: nonEmptyTrimmedStringPipe,
	}),
})
export type ProposedDeliveryTarget = PipeOutput<typeof proposedDeliveryTargetPipe>
export type ProposedSourceControlDeliveryTarget = Extract<ProposedDeliveryTarget, { type: 'source-control' }>

export const proposedSlicePipe = v.object({
	proposedSliceKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	instruction: instructionSourcePipe,
	dependsOnProposedSliceKeys: v.array(nonEmptyTrimmedStringPipe),
})
export type ProposedSlice = PipeOutput<typeof proposedSlicePipe>

export const proposedDeliveryPipe = v.object({
	proposedDeliveryKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	target: proposedDeliveryTargetPipe,
	slices: v.array(proposedSlicePipe),
	dependsOnDeliveryIds: v.array(idPipe),
	dependsOnProposedDeliveryKeys: v.array(nonEmptyTrimmedStringPipe),
})
export type ProposedDelivery = PipeOutput<typeof proposedDeliveryPipe>

export const proposedGraphRefPipe = v.discriminate((value) => value.type, {
	existing: v.object({ type: v.eq('existing'), node: graphNodeRefPipe }),
	'proposed-delivery': v.object({ type: v.eq('proposed-delivery'), proposedDeliveryKey: nonEmptyTrimmedStringPipe }),
	'proposed-slice': v.object({ type: v.eq('proposed-slice'), proposedSliceKey: nonEmptyTrimmedStringPipe }),
	'proposed-memory': v.object({ type: v.eq('proposed-memory'), proposedMemoryKey: nonEmptyTrimmedStringPipe }),
})
export type ProposedGraphRef = PipeOutput<typeof proposedGraphRefPipe>

export const proposedMemoryLinkPipe = v.discriminate((value) => value.type, {
	references: v.object({ type: v.eq('references'), to: proposedGraphRefPipe }),
	supports: v.object({ type: v.eq('supports'), to: proposedGraphRefPipe }),
	contradicts: v.object({ type: v.eq('contradicts'), to: proposedGraphRefPipe }),
	supersedes: v.object({
		type: v.eq('supersedes'),
		to: v.object({ type: v.eq('existing'), node: v.object({ type: v.eq('memory'), id: idPipe }) }),
	}),
})
export type ProposedMemoryLink = PipeOutput<typeof proposedMemoryLinkPipe>

export const proposedMemoryPipe = v.object({
	proposedMemoryKey: nonEmptyTrimmedStringPipe,
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
	links: v.array(proposedMemoryLinkPipe),
})
export type ProposedMemory = PipeOutput<typeof proposedMemoryPipe>

export const planOutputProposalPipe = v.object({
	proposedDeliveries: v.array(proposedDeliveryPipe),
	proposedMemories: v.array(proposedMemoryPipe),
})
export type PlanOutputProposal = PipeOutput<typeof planOutputProposalPipe>

export const revisionDispositionPipe = v.object({ body: freeFormStringPipe })
export type RevisionDisposition = PipeOutput<typeof revisionDispositionPipe>

export const revisionOutputProposalPipe = v.object({
	instruction: instructionSourcePipe,
	disposition: revisionDispositionPipe,
})
export type RevisionOutputProposal = PipeOutput<typeof revisionOutputProposalPipe>
