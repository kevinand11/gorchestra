import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'
import { modelUseConfigPipe } from './config'

export const agentRunProfilePipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archivePeriods: v.array(archivePeriodPipe),
})
export type AgentRunProfile = PipeOutput<typeof agentRunProfilePipe>

export const listedAgentRunProfilePipe = v.object({
	id: idPipe,
	name: nonEmptyTrimmedStringPipe,
	modelUse: modelUseConfigPipe,
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archived: v.boolean(),
})
export type ListedAgentRunProfile = PipeOutput<typeof listedAgentRunProfilePipe>
