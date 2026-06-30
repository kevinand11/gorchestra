import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { memoryPipe, type Memory } from '../domain/memory'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ parentId: v.nullable(idPipe) })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(memoryPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListMemoryChildrenQuery(options: CoreServices): Operation {
	return buildQueryHandler('listMemoryChildren', inputPipe, (input) =>
		withTransaction(options, (storage) => listMemoryChildren(storage, input.parentId)),
	)
}

async function listMemoryChildren(
	storage: CoreStorage,
	parentId: string | null,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	if (parentId !== null) {
		const parent = await getRequired('memory', storage, parentId)
		if (!parent.ok) return parent
	}

	const children = await listRecords('memory', storage, { where: (filter, fields) => filter.eq(fields.parentId, parentId) })
	return children.ok ? { ok: true, value: sortMemoriesByTitleThenId(children.value) } : children
}

function sortMemoriesByTitleThenId(memories: Memory[]): Memory[] {
	return [...memories].sort(
		(left, right) => left.currentRevision.title.localeCompare(right.currentRevision.title) || left.id.localeCompare(right.id),
	)
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

		it('lists root Memories sorted by current title then id', async () => {
			const options = createTestCoreServices()
			const memoryB = memory({ id: 'memory-b', parentId: null, title: 'Beta' })
			const memoryA = memory({ id: 'memory-a', parentId: null, title: 'Alpha' })
			const memoryChild = memory({ id: 'memory-child', parentId: 'memory-a', title: 'Child' })
			options.tx.memories.records.set(memoryB.id, memoryB)
			options.tx.memories.records.set(memoryA.id, memoryA)
			options.tx.memories.records.set(memoryChild.id, memoryChild)

			const result = await createListMemoryChildrenQuery(options)({ parentId: null })

			expect(result).toEqual({ ok: true, value: [memoryA, memoryB] })
		})

		it('validates a non-null parent before listing direct children', async () => {
			const options = createTestCoreServices()
			const parent = memory({ id: 'memory-parent', parentId: null, title: 'Parent' })
			const childA = memory({ id: 'memory-child-a', parentId: parent.id, title: 'Alpha' })
			const childB = memory({ id: 'memory-child-b', parentId: parent.id, title: 'Beta' })
			const grandchild = memory({ id: 'memory-grandchild', parentId: childA.id, title: 'Grandchild' })
			for (const record of [parent, childB, childA, grandchild]) options.tx.memories.records.set(record.id, record)

			const result = await createListMemoryChildrenQuery(options)({ parentId: parent.id })

			expect(result).toEqual({ ok: true, value: [childA, childB] })
		})

		it('returns not-found for a missing parent', async () => {
			const result = await createListMemoryChildrenQuery(createTestCoreServices())({ parentId: 'missing-parent' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: 'missing-parent' } })
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
