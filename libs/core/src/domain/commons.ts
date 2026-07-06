import { v, type Pipe, type PipeOutput } from 'valleyed'

const rawStringPipe = v.string()
export const nonEmptyRawStringPipe = rawStringPipe.pipe(v.min(1))
const trimmedStringPipe = rawStringPipe.pipe(v.asTrimmed())
export const nonEmptyTrimmedStringPipe = trimmedStringPipe.pipe(v.min(1))
export const freeFormStringPipe = trimmedStringPipe

const integerPipe = v.number().pipe(v.int())
export const positiveIntegerPipe = integerPipe.pipe(v.gte(1))
export const nonNegativeIntegerPipe = integerPipe.pipe(v.gte(0))

export const idPipe = nonEmptyTrimmedStringPipe.pipe(v.custom((value) => /^[0-9a-hjkmnp-tv-z]{26}$/.test(value), 'Expected a Core id.'))
export type Id = PipeOutput<typeof idPipe>

export const maxPaginatedQueryLimit = 500

const paginatedQueryLimitInputPipe = v.fromJson(positiveIntegerPipe.pipe(v.lte(maxPaginatedQueryLimit)))
const paginatedQueryPageNumberInputPipe = v.fromJson(positiveIntegerPipe)
const paginatedQueryBeforeIdInputPipe = v.optional(v.fromJson(idPipe))

const paginatedQueryBatchInputPipe = v.object({
	beforeId: paginatedQueryBeforeIdInputPipe,
	limit: v.optional(paginatedQueryLimitInputPipe),
})

const paginatedQueryPageInputPipe = v.object({
	beforeId: paginatedQueryBeforeIdInputPipe,
	limit: paginatedQueryLimitInputPipe,
	page: paginatedQueryPageNumberInputPipe,
})

export const paginatedQueryInputPipe = v.discriminate(
	(input) => (typeof input === 'object' && input !== null && 'page' in input ? 'page' : 'batch'),
	{
		batch: paginatedQueryBatchInputPipe,
		page: paginatedQueryPageInputPipe,
	},
)
export type PaginatedQueryInput = { beforeId?: Id; limit?: number } | { beforeId?: Id; limit: number; page: number }
export type ParsedPaginatedQueryInput = PipeOutput<typeof paginatedQueryInputPipe>

export function paginatedQueryEnvelopePipe<TInput, TOutput>(itemPipe: Pipe<TInput, TOutput>) {
	return v.object({
		pages: v.object({
			current: positiveIntegerPipe,
			start: positiveIntegerPipe,
			last: positiveIntegerPipe,
			previous: v.nullable(positiveIntegerPipe),
			next: v.nullable(positiveIntegerPipe),
		}),
		docs: v.object({
			limit: nonNegativeIntegerPipe,
			total: nonNegativeIntegerPipe,
			count: nonNegativeIntegerPipe,
		}),
		items: v.array(itemPipe),
	})
}

export type PaginatedQueryEnvelope<T> = {
	pages: { current: number; start: number; last: number; previous: number | null; next: number | null }
	docs: { limit: number; total: number; count: number }
	items: T[]
}

export function mapPaginatedQueryEnvelope<TInput, TOutput>(
	envelope: PaginatedQueryEnvelope<TInput>,
	map: (item: TInput) => TOutput,
): PaginatedQueryEnvelope<TOutput> {
	return { ...envelope, items: envelope.items.map(map) }
}

export const jsonObjectPipe = v.record(v.string(), v.any<unknown>())
export type JsonObject = PipeOutput<typeof jsonObjectPipe>

export const isoDateTimePipe = v.time().pipe(v.asISOString()) as Pipe<string, string>
export type IsoDateTime = PipeOutput<typeof isoDateTimePipe>

export const localActorRefPipe = v.object({ type: rawStringPipe, id: rawStringPipe })
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
