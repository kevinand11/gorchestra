import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const memoryTypePipe = v.in(['decision', 'fact', 'constraint', 'assumption', 'risk', 'architecture', 'workflow', 'convention'])
export type MemoryType = PipeOutput<typeof memoryTypePipe>

export const memoryPipe = v.object({
	id: idPipe,
	title: nonEmptyTrimmedStringPipe,
	body: freeFormStringPipe,
	type: v.nullable(memoryTypePipe),
	created: auditStampPipe,
})
export type Memory = PipeOutput<typeof memoryPipe>
