import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const memoryTitlePipe = nonEmptyTrimmedStringPipe
export const memoryBodyPipe = v.string().pipe(v.asTrimmed())

export const currentMemoryRevisionPipe = v.object({
	id: idPipe,
	title: memoryTitlePipe,
	body: memoryBodyPipe,
	created: auditStampPipe,
})
export type CurrentMemoryRevision = PipeOutput<typeof currentMemoryRevisionPipe>

export const memoryRevisionSchema = coreSchema('memory_revisions')
	.field('memoryId', idPipe)
	.field('title', memoryTitlePipe)
	.field('body', memoryBodyPipe)
	.field('created', auditStampPipe)
	.build()
export const memoryRevisionPipe = schemaToPipe(memoryRevisionSchema)
export type MemoryRevision = PipeOutput<typeof memoryRevisionPipe>
