import { v, type PipeOutput } from 'valleyed'

import { localActorRefPipe } from '../domain/commons'

export const commandContextPipe = v.object({ actor: localActorRefPipe, correlationId: v.nullable(v.string()) })
export type CommandContext = PipeOutput<typeof commandContextPipe>
