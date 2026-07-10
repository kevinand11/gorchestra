import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe } from './commons'
import { instructionSourcePipe, revisionDispositionPipe } from './proposals'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'
export { revisionDispositionPipe, revisionOutputProposalPipe } from './proposals'
export type { RevisionDisposition, RevisionOutputProposal } from './proposals'

export const revisionScopePipe = v.discriminate((value) => value.type, {
	'slice-artifact': v.object({ type: v.eq('slice-artifact'), sliceId: idPipe, sliceArtifactId: idPipe }),
	'delivery-artifact': v.object({ type: v.eq('delivery-artifact'), deliveryId: idPipe, deliveryArtifactId: idPipe }),
})
export type RevisionScope = PipeOutput<typeof revisionScopePipe>

export const revisionSchema = coreSchema('revisions')
	.field('revisionGateId', idPipe)
	.field('scope', revisionScopePipe)
	.field('instruction', instructionSourcePipe)
	.field('disposition', revisionDispositionPipe)
	.field('accepted', auditStampPipe)
	.build()
export const revisionPipe = schemaToPipe(revisionSchema)
export type Revision = PipeOutput<typeof revisionPipe>
