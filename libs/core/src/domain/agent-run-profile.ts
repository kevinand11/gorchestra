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

export const agentRunProfileReferenceRolePipe = v.in(['execution', 'revision-execution'])
export type AgentRunProfileReferenceRole = PipeOutput<typeof agentRunProfileReferenceRolePipe>

export const projectConfigAgentRunProfileReferencePipe = v.object({
	type: v.eq('project-config'),
	active: v.boolean(),
	role: agentRunProfileReferenceRolePipe,
	projectId: idPipe,
	projectTitle: nonEmptyTrimmedStringPipe,
})
export type ProjectConfigAgentRunProfileReference = PipeOutput<typeof projectConfigAgentRunProfileReferencePipe>

export const deliveryConfigAgentRunProfileReferencePipe = v.object({
	type: v.eq('delivery-config'),
	active: v.boolean(),
	role: agentRunProfileReferenceRolePipe,
	projectId: idPipe,
	deliveryId: idPipe,
	deliveryTitle: nonEmptyTrimmedStringPipe,
})
export type DeliveryConfigAgentRunProfileReference = PipeOutput<typeof deliveryConfigAgentRunProfileReferencePipe>

export const agentRunProfileReferencePipe = v.discriminate((value) => value.type, {
	'project-config': projectConfigAgentRunProfileReferencePipe,
	'delivery-config': deliveryConfigAgentRunProfileReferencePipe,
})
export type AgentRunProfileReference = PipeOutput<typeof agentRunProfileReferencePipe>
