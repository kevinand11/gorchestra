import { v, type Pipe, type PipeOutput } from 'valleyed'

import { serverIdPipe } from './server-id'

const integerPipe = v.number().pipe(v.int())
export const serverPositiveIntegerPipe = integerPipe.pipe(v.gte(1))
export const serverNonNegativeIntegerPipe = integerPipe.pipe(v.gte(0))
export const maxServerPaginatedQueryLimit = 500

const serverPaginatedQueryLimitInputPipe = v.fromJson(serverPositiveIntegerPipe.pipe(v.lte(maxServerPaginatedQueryLimit)))
const serverPaginatedQueryPageNumberInputPipe = v.fromJson(serverPositiveIntegerPipe)
const serverPaginatedQueryBeforeIdInputPipe = v.optional(v.fromJson(serverIdPipe))

const serverPaginatedQueryBatchInputPipe = v.object({
	beforeId: serverPaginatedQueryBeforeIdInputPipe,
	limit: v.optional(serverPaginatedQueryLimitInputPipe),
})

const serverPaginatedQueryPageInputPipe = v.object({
	beforeId: serverPaginatedQueryBeforeIdInputPipe,
	limit: serverPaginatedQueryLimitInputPipe,
	page: serverPaginatedQueryPageNumberInputPipe,
})

export const serverPaginatedQueryInputPipe = v.discriminate(
	(input) => (typeof input === 'object' && input !== null && 'page' in input ? 'page' : 'batch'),
	{
		batch: serverPaginatedQueryBatchInputPipe,
		page: serverPaginatedQueryPageInputPipe,
	},
)

export type ServerPaginatedQueryInput = { beforeId?: string; limit?: number } | { beforeId?: string; limit: number; page: number }
export type ParsedServerPaginatedQueryInput = PipeOutput<typeof serverPaginatedQueryInputPipe>

export type ServerPaginatedQueryEnvelope<T> = {
	pages: { current: number; start: number; last: number; previous: number | null; next: number | null }
	docs: { limit: number; total: number; count: number }
	items: T[]
}

export function serverPaginatedQueryEnvelopePipe<TInput, TOutput>(itemPipe: Pipe<TInput, TOutput>) {
	return v.object({
		pages: v.object({
			current: serverPositiveIntegerPipe,
			start: serverPositiveIntegerPipe,
			last: serverPositiveIntegerPipe,
			previous: v.nullable(serverPositiveIntegerPipe),
			next: v.nullable(serverPositiveIntegerPipe),
		}),
		docs: v.object({
			limit: serverNonNegativeIntegerPipe,
			total: serverNonNegativeIntegerPipe,
			count: serverNonNegativeIntegerPipe,
		}),
		items: v.array(itemPipe),
	})
}

export function emptyServerPaginatedQueryEnvelope<T>(): ServerPaginatedQueryEnvelope<T> {
	return {
		items: [],
		pages: { current: 1, start: 1, last: 1, previous: null, next: null },
		docs: { limit: 0, total: 0, count: 0 },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Server pagination', () => {
		it('parses batch and page query inputs with Server id beforeId boundaries', () => {
			const beforeId = '01k00000000000000000000001'

			expect(v.validate(serverPaginatedQueryInputPipe, { beforeId, limit: '2' })).toMatchObject({
				valid: true,
				value: { beforeId, limit: 2 },
			})
			expect(v.validate(serverPaginatedQueryInputPipe, { beforeId, limit: '2', page: '3' })).toMatchObject({
				valid: true,
				value: { beforeId, limit: 2, page: 3 },
			})
			expect(v.validate(serverPaginatedQueryInputPipe, { beforeId: crypto.randomUUID(), limit: '2' })).toMatchObject({
				valid: false,
			})
		})
	})
}
