import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe, paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { memoryPipe, type Memory } from '../domain/memory'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = v.merge(v.object({ parentId: v.nullable(idPipe) }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(memoryPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListMemoryChildrenQuery(options: CoreServices): Operation {
	return buildQueryHandler('listMemoryChildren', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			if (input.parentId !== null) {
				const parent = await getRequired('memory', storage, input.parentId)
				if (!parent.ok) return parent
			}

			return await listRecordsPaginated('memory', storage, input, {
				where: (filter, fields) => filter.eq(fields.parentId, input.parentId),
			})
		}),
	) as Operation
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, stamp } = await import('../utils/test-helpers')

	describe('listMemoryChildren query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.list = true
			const query = createListMemoryChildrenQuery(options)

			const result = await query({ parentId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listMemoryChildren' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('lists root Memories in id-desc order', async () => {
			const options = createTestCoreServices()
			const memoryB = memory({ id: '01k00000000000000000100002', parentId: null, title: 'Beta' })
			const memoryA = memory({ id: '01k00000000000000000100001', parentId: null, title: 'Alpha' })
			const memoryChild = memory({ id: '01k00000000000000000100004', parentId: '01k00000000000000000100001', title: 'Child' })
			options.tx.memories.records.set(memoryB.id, memoryB)
			options.tx.memories.records.set(memoryA.id, memoryA)
			options.tx.memories.records.set(memoryChild.id, memoryChild)

			const result = await createListMemoryChildrenQuery(options)({ parentId: null })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [memoryB, memoryA],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('validates a non-null parent before listing direct children', async () => {
			const options = createTestCoreServices()
			const parent = memory({ id: '01k00000000000000000100008', parentId: null, title: 'Parent' })
			const childA = memory({ id: '01k00000000000000000100005', parentId: parent.id, title: 'Alpha' })
			const childB = memory({ id: '01k00000000000000000100006', parentId: parent.id, title: 'Beta' })
			const grandchild = memory({ id: '01k00000000000000000100007', parentId: childA.id, title: 'Grandchild' })
			for (const record of [parent, childB, childA, grandchild]) options.tx.memories.records.set(record.id, record)

			const result = await createListMemoryChildrenQuery(options)({ parentId: parent.id })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [childB, childA],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('returns not-found for a missing parent', async () => {
			const result = await createListMemoryChildrenQuery(createTestCoreServices())({ parentId: '01k00000000000000000100054' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: '01k00000000000000000100054' } })
		})

		it('returns storage errors from child listing', async () => {
			const listFailure = createTestCoreServices()
			listFailure.tx.memories.fail.list = true
			await expect(createListMemoryChildrenQuery(listFailure)({ parentId: null })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'memory' } },
			})
		})
	})

	function memory(input: { id: string; parentId: string | null; title: string }): Memory {
		return {
			id: input.id,
			parentId: input.parentId,
			created: stamp,
			currentRevision: { id: `${input.id}-revision`, title: input.title, body: `${input.title} body`, created: stamp },
		}
	}
}
