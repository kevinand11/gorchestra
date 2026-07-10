import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedMemoryPipe, type Memory } from '../domain/memory'
import { type MemoryRevision } from '../domain/memory-revision'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecords, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ memoryId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedMemoryPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetMemoryQuery(options: CoreServices): Operation {
	return buildQueryHandler('getMemory', inputPipe, (input) =>
		withTransaction<Result, Exclude<Error, InvalidInputError>>(options, async (storage) => {
			const memory = await getRequired('memory', storage, input.memoryId)
			if (!memory.ok) return memory

			const revisions = await listRecords('memory-revision', storage, {
				where: (filter, fields) => filter.eq(fields.memoryId, memory.value.id),
				orderBy: [{ field: 'id', direction: 'desc' }],
			})
			if (!revisions.ok) return revisions
			if (!revisions.value.some((revision) => revision.id === memory.value.currentRevision.id)) {
				return {
					ok: false,
					error: {
						type: 'invariant-violation',
						message: `Memory ${memory.value.id} current revision ${memory.value.currentRevision.id} is missing.`,
					},
				}
			}

			const children = await listRecords('memory', storage, {
				where: (filter, fields) => filter.eq(fields.parentId, memory.value.id),
				orderBy: [{ field: 'id', direction: 'desc' }],
			})
			return children.ok ? { ok: true, value: { ...memory.value, revisions: revisions.value, children: children.value } } : children
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, stamp } = await import('../utils/test-helpers')

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

		it('returns a ListedMemory with revisions and direct children in id-desc order', async () => {
			const options = createTestCoreServices()
			const parent = memory({ id: '01k00000000000000000100008', title: 'Parent', currentRevisionId: '01k00000000000000000100011' })
			const childB = memory({ id: '01k00000000000000000100006', parentId: parent.id, title: 'Beta' })
			const childA = memory({ id: '01k00000000000000000100005', parentId: parent.id, title: 'Alpha' })
			const revisionOlder = revision({
				id: '01k00000000000000000100012',
				memoryId: parent.id,
				title: 'Older',
				createdAt: '2026-06-09T00:00:00.000Z',
			})
			const revisionCurrent = revision({
				id: '01k00000000000000000100011',
				memoryId: parent.id,
				title: 'Parent',
				createdAt: '2026-06-10T00:00:00.000Z',
			})
			for (const record of [parent, childB, childA]) options.tx.memories.records.set(record.id, record)
			for (const record of [revisionOlder, revisionCurrent]) options.tx.memoryRevisions.records.set(record.id, record)

			const result = await createGetMemoryQuery(options)({ memoryId: parent.id })

			expect(result).toEqual({
				ok: true,
				value: { ...parent, revisions: [revisionOlder, revisionCurrent], children: [childB, childA] },
			})
		})

		it('returns not-found when the target Memory does not exist', async () => {
			const result = await createGetMemoryQuery(createTestCoreServices())({ memoryId: '01k00000000000000000000019' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: '01k00000000000000000000019' } })
		})

		it('returns invariant-violation when current revision is missing from revision history', async () => {
			const options = createTestCoreServices()
			const storedMemory = memory({
				id: '01k00000000000000000000019',
				title: 'Memory',
				currentRevisionId: '01k00000000000000000010020',
			})
			options.tx.memories.records.set(storedMemory.id, storedMemory)

			const result = await createGetMemoryQuery(options)({ memoryId: storedMemory.id })

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'invariant-violation',
					message: 'Memory 01k00000000000000000000019 current revision 01k00000000000000000010020 is missing.',
				},
			})
		})

		it('returns storage errors when revision or child reads fail', async () => {
			const revisionReadFailure = createTestCoreServices()
			revisionReadFailure.tx.memories.records.set(
				'01k00000000000000000000019',
				memory({ id: '01k00000000000000000000019', title: 'Memory' }),
			)
			revisionReadFailure.tx.memoryRevisions.fail.list = true
			await expect(createGetMemoryQuery(revisionReadFailure)({ memoryId: '01k00000000000000000000019' })).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'memory-revision' } },
			})
		})
	})

	function memory(input: { id: string; title: string; parentId?: string | null; currentRevisionId?: string }): Memory {
		return {
			id: input.id,
			parentId: input.parentId ?? null,
			created: stamp,
			currentRevision: {
				id: input.currentRevisionId ?? '01k00000000000000000010021',
				title: input.title,
				body: `${input.title} body`,
				created: stamp,
			},
		}
	}

	function revision(input: { id: string; memoryId: string; title: string; createdAt?: string }): MemoryRevision {
		return {
			id: input.id,
			memoryId: input.memoryId,
			title: input.title,
			body: `${input.title} body`,
			created: { ...stamp, at: input.createdAt ?? stamp.at },
		}
	}
}
