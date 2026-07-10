import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe } from './commons'
import { revisionScopePipe } from './revision'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const revisionGateClosedPipe = v.discriminate((value) => value.type, {
	'closed-without-revision': v.object({ type: v.eq('closed-without-revision'), closed: auditStampPipe }),
	'consumed-by-revision': v.object({ type: v.eq('consumed-by-revision'), consumed: auditStampPipe, revisionId: idPipe }),
})
export type RevisionGateClosed = PipeOutput<typeof revisionGateClosedPipe>

export const revisionGateSchema = coreSchema('revision_gates')
	.field('agentRunId', idPipe)
	.field('scope', revisionScopePipe)
	.field('reviewSurfaceId', idPipe)
	.field('opened', auditStampPipe)
	.field('closed', v.nullable(revisionGateClosedPipe))
	.build()
export const revisionGatePipe = schemaToPipe(revisionGateSchema)
export type RevisionGate = PipeOutput<typeof revisionGatePipe>
