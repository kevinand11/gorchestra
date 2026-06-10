import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, freeFormStringPipe, idPipe } from './commons'
import { instructionSourcePipe } from './plan'

export const revisionScopePipe = v.discriminate((value) => value.type, {
	'slice-artifact': v.object({ type: v.eq('slice-artifact'), sliceId: idPipe, sliceArtifactId: idPipe }),
	'delivery-artifact': v.object({ type: v.eq('delivery-artifact'), deliveryId: idPipe, deliveryArtifactId: idPipe }),
})
export type RevisionScope = PipeOutput<typeof revisionScopePipe>

export const revisionDispositionPipe = v.object({ body: freeFormStringPipe })
export type RevisionDisposition = PipeOutput<typeof revisionDispositionPipe>

export const revisionOutputProposalPipe = v.object({
	instruction: instructionSourcePipe,
	disposition: revisionDispositionPipe,
})
export type RevisionOutputProposal = PipeOutput<typeof revisionOutputProposalPipe>

export const revisionGatePipe = v.object({
	id: idPipe,
	scope: revisionScopePipe,
	reviewSurfaceId: idPipe,
	opened: auditStampPipe,
	closed: v.nullable(auditStampPipe),
	consumedByRevisionId: v.nullable(idPipe),
})
export type RevisionGate = PipeOutput<typeof revisionGatePipe>

export const revisionPipe = v.object({
	id: idPipe,
	revisionGateId: idPipe,
	scope: revisionScopePipe,
	instruction: instructionSourcePipe,
	disposition: revisionDispositionPipe,
	accepted: auditStampPipe,
})
export type Revision = PipeOutput<typeof revisionPipe>
