import { v, type PipeOutput } from 'valleyed'

import type { UndefinedToOptional } from '../utils/types'

export const workContextPipe = v.object({
	correlationId: v.nullable(v.string()),
	signal: v.optional(v.instanceOf(AbortSignal)),
})
export type WorkContext = UndefinedToOptional<PipeOutput<typeof workContextPipe>>
