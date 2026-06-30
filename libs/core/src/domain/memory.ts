import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const memoryTitlePipe = nonEmptyTrimmedStringPipe
export const memoryBodyPipe = v.string().pipe(v.asTrimmed())

export const currentMemoryRevisionPipe = v.object({
	id: idPipe,
	title: memoryTitlePipe,
	body: memoryBodyPipe,
	created: auditStampPipe,
})
export type CurrentMemoryRevision = PipeOutput<typeof currentMemoryRevisionPipe>

export const memoryPipe = v.object({
	id: idPipe,
	parentId: v.nullable(idPipe),
	created: auditStampPipe,
	currentRevision: currentMemoryRevisionPipe,
})
export type Memory = PipeOutput<typeof memoryPipe>

export const memoryRevisionPipe = v.merge(currentMemoryRevisionPipe, v.object({ memoryId: idPipe }))
export type MemoryRevision = PipeOutput<typeof memoryRevisionPipe>

export const listedMemoryPipe = v.merge(
	memoryPipe,
	v.object({
		revisions: v.array(memoryRevisionPipe),
		children: v.array(memoryPipe),
	}),
)
export type ListedMemory = PipeOutput<typeof listedMemoryPipe>
