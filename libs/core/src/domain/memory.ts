import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { linkPipe } from './graph'

export const memoryTypePipe = v.in(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'])
export type MemoryType = PipeOutput<typeof memoryTypePipe>

export const memoryBodyPipe = v.string().pipe(v.asTrimmed())

export const memoryPipe = v.object({
	id: idPipe,
	title: nonEmptyTrimmedStringPipe,
	body: memoryBodyPipe,
	type: memoryTypePipe,
	created: auditStampPipe,
})
export type Memory = PipeOutput<typeof memoryPipe>

export const memoryStatusPipe = v.in(['current', 'superseded'])
export type MemoryStatus = PipeOutput<typeof memoryStatusPipe>

export const memoryReadModelPipe = v.merge(memoryPipe, v.object({ status: memoryStatusPipe, links: v.array(linkPipe) }))
export type MemoryReadModel = PipeOutput<typeof memoryReadModelPipe>
