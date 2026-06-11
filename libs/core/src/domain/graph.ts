import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe } from './commons'

export const graphNodeRefPipe = v.discriminate((value) => value.type, {
	plan: v.object({ type: v.eq('plan'), id: idPipe }),
	project: v.object({ type: v.eq('project'), id: idPipe }),
	delivery: v.object({ type: v.eq('delivery'), id: idPipe }),
	slice: v.object({ type: v.eq('slice'), id: idPipe }),
	memory: v.object({ type: v.eq('memory'), id: idPipe }),
})
export type GraphNodeRef = PipeOutput<typeof graphNodeRefPipe>

export const linkTypePipe = v.in(['produced', 'references', 'supersedes', 'supports', 'contradicts', 'depends-on'])
export type LinkType = PipeOutput<typeof linkTypePipe>

export const linkPipe = v.object({
	id: idPipe,
	type: linkTypePipe,
	from: graphNodeRefPipe,
	to: graphNodeRefPipe,
	created: auditStampPipe,
	archivePeriods: v.array(archivePeriodPipe),
})
export type Link = PipeOutput<typeof linkPipe>
