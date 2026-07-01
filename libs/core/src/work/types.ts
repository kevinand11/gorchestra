import { v, type PipeOutput } from 'valleyed'

export const workContextPipe = v.object({ correlationId: v.nullable(v.string()) })
export type WorkContext = PipeOutput<typeof workContextPipe>
