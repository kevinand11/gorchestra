import { v, type PipeOutput } from 'valleyed'

import { archivePeriodPipe, auditStampPipe, idPipe, nonEmptyTrimmedStringPipe } from './commons'

export const modelPipe = v.object({
	id: idPipe,
	providerId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archivePeriods: v.array(archivePeriodPipe),
})
export type Model = PipeOutput<typeof modelPipe>
