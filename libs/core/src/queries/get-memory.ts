import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { memoryReadModel, type MemoryReadModel } from './memory-read-model'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const getMemoryInputPipe = v.object({ memoryId: idPipe })
export type Input = PipeOutput<typeof getMemoryInputPipe>

export type Result = MemoryReadModel
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetMemoryQuery(options: CoreServices): Operation {
	return buildQueryHandler('getMemory', getMemoryInputPipe, (input) =>
		withTransaction(options, (storage) => getMemoryReadModel(storage, input.memoryId)),
	)
}

async function getMemoryReadModel(storage: CoreStorage, memoryId: string): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const memory = await getRequired('memory', storage, memoryId)
	if (!memory.ok) return memory

	const links = await listRecords('link', storage, {
		where: (filter, fields) =>
			filter.or([
				(group) => group.eq(fields.from, { type: 'memory', id: memory.value.id }),
				(group) => group.eq(fields.to, { type: 'memory', id: memory.value.id }),
			]),
	})
	return links.ok ? { ok: true, value: memoryReadModel(memory.value, links.value) } : links
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, stamp } = await import('../utils/test-helpers')
	const { link, memory } = testRecords()

	describe('getMemory query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.get = true

			const result = await createGetMemoryQuery(options)({ memoryId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getMemory' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns a Memory read model with status and all direct Links', async () => {
			const options = createTestCoreServices()
			const storedMemory = memory('memory-1')
			const supersedingMemory = memory('memory-2')
			const supersedesLink = link(
				'link-1',
				'supersedes',
				{ type: 'memory', id: supersedingMemory.id },
				{ type: 'memory', id: storedMemory.id },
			)
			const supportsLink = link('link-2', 'supports', { type: 'memory', id: storedMemory.id }, { type: 'delivery', id: 'delivery-1' })
			options.tx.memories.records.set(storedMemory.id, storedMemory)
			options.tx.memories.records.set(supersedingMemory.id, supersedingMemory)
			options.tx.links.records.set(supersedesLink.id, supersedesLink)
			options.tx.links.records.set(supportsLink.id, supportsLink)

			const result = await createGetMemoryQuery(options)({ memoryId: storedMemory.id })

			expect(result).toEqual({ ok: true, value: { ...storedMemory, status: 'superseded', links: [supersedesLink, supportsLink] } })
		})

		it('returns not-found when the target Memory does not exist', async () => {
			const result = await createGetMemoryQuery(createTestCoreServices())({ memoryId: 'memory-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: 'memory-1' } })
		})

		it('returns storage errors when Link reads fail', async () => {
			const options = createTestCoreServices()
			options.tx.memories.records.set('memory-1', memory('memory-1'))
			options.tx.links.fail.list = true

			const result = await createGetMemoryQuery(options)({ memoryId: 'memory-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'link' } },
			})
		})
	})

	function testRecords() {
		return {
			memory: (id: string) => ({ id, title: 'Memory', body: 'Body', type: null, created: stamp }),
			link: (
				id: string,
				type: 'supersedes' | 'supports',
				from: { type: 'memory'; id: string },
				to: { type: 'memory' | 'delivery'; id: string },
			) => ({
				id,
				type,
				from,
				to,
				created: stamp,
				archivePeriods: [],
			}),
		}
	}
}
