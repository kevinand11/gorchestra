import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe } from './commons'
import { currentMemoryRevisionPipe, memoryRevisionPipe } from './memory-revision'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const memorySchema = coreSchema('memories')
	.field('parentId', v.nullable(idPipe))
	.field('currentRevision', currentMemoryRevisionPipe)
	.field('created', auditStampPipe)
	.build()
export const memoryPipe = schemaToPipe(memorySchema)
export type Memory = PipeOutput<typeof memoryPipe>

export const listedMemoryPipe = v.merge(
	memoryPipe,
	v.object({
		revisions: v.array(memoryRevisionPipe),
		children: v.array(memoryPipe),
	}),
)
export type ListedMemory = PipeOutput<typeof listedMemoryPipe>
