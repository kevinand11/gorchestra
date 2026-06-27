import { v, type Pipe, type PipeOutput } from 'valleyed'

const rawStringPipe = v.string()
export const nonEmptyRawStringPipe = rawStringPipe.pipe(v.min(1))
const trimmedStringPipe = rawStringPipe.pipe(v.asTrimmed())
export const nonEmptyTrimmedStringPipe = trimmedStringPipe.pipe(v.min(1))
export const freeFormStringPipe = trimmedStringPipe

const integerPipe = v.number().pipe(v.int())
export const positiveIntegerPipe = integerPipe.pipe(v.gte(1))
export const nonNegativeIntegerPipe = integerPipe.pipe(v.gte(0))

export const idPipe = nonEmptyTrimmedStringPipe
export type Id = PipeOutput<typeof idPipe>

export const isoDateTimePipe = v.time().pipe(v.asISOString()) as Pipe<string, string>
export type IsoDateTime = PipeOutput<typeof isoDateTimePipe>

const localActorRefPipe = v.object({ type: rawStringPipe, id: rawStringPipe })
export type LocalActorRef = PipeOutput<typeof localActorRefPipe>

const localAuditStampPipe = v.object({
	origin: v.eq('local'),
	at: isoDateTimePipe,
	actor: localActorRefPipe,
	correlationId: v.nullable(rawStringPipe),
})
export type LocalAuditStamp = PipeOutput<typeof localAuditStampPipe>

const importedAuditStampPipe = v.object({ origin: v.eq('imported'), at: isoDateTimePipe })
export type ImportedAuditStamp = PipeOutput<typeof importedAuditStampPipe>

export const auditStampPipe = v.discriminate((value) => value.origin, {
	local: localAuditStampPipe,
	imported: importedAuditStampPipe,
})
export type AuditStamp = PipeOutput<typeof auditStampPipe>

export const archivePeriodPipe = v.object({ archived: auditStampPipe, unarchived: v.nullable(auditStampPipe) })
export type ArchivePeriod = PipeOutput<typeof archivePeriodPipe>

export const runtimeRecordPipe = v.object({ at: isoDateTimePipe })
export type RuntimeRecord = PipeOutput<typeof runtimeRecordPipe>

export const operationContextPipe = v.object({ actor: localActorRefPipe, correlationId: v.nullable(rawStringPipe) })
export type OperationContext = PipeOutput<typeof operationContextPipe>
