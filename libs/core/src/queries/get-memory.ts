import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedMemoryPipe, type ListedMemory, type Memory, type MemoryRevision } from '../domain/memory'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

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
		withTransaction(options, (storage) => getListedMemory(storage, input.memoryId)),
	)
}

async function getListedMemory(storage: CoreStorage, memoryId: string): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const memory = await getRequired('memory', storage, memoryId)
	return memory.ok ? getListedMemoryForRecord(storage, memory.value) : memory
}

async function getListedMemoryForRecord(
	storage: CoreStorage,
	memory: Memory,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revisions = await listMemoryRevisions(storage, memory.id)
	return revisions.ok ? getListedMemoryWithRevisions(storage, memory, revisions.value) : revisions
}

function getListedMemoryWithRevisions(
	storage: CoreStorage,
	memory: Memory,
	revisions: MemoryRevision[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return currentRevisionExists(memory, revisions)
		? getListedMemoryWithChildren(storage, memory, revisions)
		: Promise.resolve(missingCurrentRevision(memory))
}

async function getListedMemoryWithChildren(
	storage: CoreStorage,
	memory: Memory,
	revisions: MemoryRevision[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const children = await listMemoryChildren(storage, memory.id)
	return children.ok ? { ok: true, value: listedMemory(memory, revisions, children.value) } : children
}

async function listMemoryRevisions(
	storage: CoreStorage,
	memoryId: string,
): Promise<CoreResult<MemoryRevision[], InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const revisions = await listRecords('memory-revision', storage, { where: (filter, fields) => filter.eq(fields.memoryId, memoryId) })
	return revisions.ok ? { ok: true, value: sortRevisionsNewestFirst(revisions.value) } : revisions
}

async function listMemoryChildren(
	storage: CoreStorage,
	memoryId: string,
): Promise<CoreResult<Memory[], InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const children = await listRecords('memory', storage, { where: (filter, fields) => filter.eq(fields.parentId, memoryId) })
	return children.ok ? { ok: true, value: sortMemoriesByTitleThenId(children.value) } : children
}

function listedMemory(memory: Memory, revisions: MemoryRevision[], children: Memory[]): ListedMemory {
	return { ...memory, revisions, children }
}

function currentRevisionExists(memory: Memory, revisions: MemoryRevision[]): boolean {
	return revisions.some((revision) => revision.id === memory.currentRevision.id)
}

function missingCurrentRevision(memory: Memory): CoreResult<never, InvariantViolationError> {
	return {
		ok: false,
		error: { type: 'invariant-violation', message: `Memory ${memory.id} current revision ${memory.currentRevision.id} is missing.` },
	}
}

function sortMemoriesByTitleThenId(memories: Memory[]): Memory[] {
	return [...memories].sort(
		(left, right) => left.currentRevision.title.localeCompare(right.currentRevision.title) || left.id.localeCompare(right.id),
	)
}

function sortRevisionsNewestFirst(revisions: MemoryRevision[]): MemoryRevision[] {
	return [...revisions].sort((left, right) => right.created.at.localeCompare(left.created.at) || right.id.localeCompare(left.id))
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

		it('returns a ListedMemory with revisions newest-first and direct children sorted by title', async () => {
			const options = createTestCoreServices()
			const parent = memory({ id: 'memory-parent', title: 'Parent', currentRevisionId: 'revision-current' })
			const childB = memory({ id: 'memory-child-b', parentId: parent.id, title: 'Beta' })
			const childA = memory({ id: 'memory-child-a', parentId: parent.id, title: 'Alpha' })
			const revisionOlder = revision({
				id: 'revision-older',
				memoryId: parent.id,
				title: 'Older',
				createdAt: '2026-06-09T00:00:00.000Z',
			})
			const revisionCurrent = revision({
				id: 'revision-current',
				memoryId: parent.id,
				title: 'Parent',
				createdAt: '2026-06-10T00:00:00.000Z',
			})
			for (const record of [parent, childB, childA]) options.tx.memories.records.set(record.id, record)
			for (const record of [revisionOlder, revisionCurrent]) options.tx.memoryRevisions.records.set(record.id, record)

			const result = await createGetMemoryQuery(options)({ memoryId: parent.id })

			expect(result).toEqual({
				ok: true,
				value: { ...parent, revisions: [revisionCurrent, revisionOlder], children: [childA, childB] },
			})
		})

		it('returns not-found when the target Memory does not exist', async () => {
			const result = await createGetMemoryQuery(createTestCoreServices())({ memoryId: 'memory-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: 'memory-1' } })
		})

		it('returns invariant-violation when current revision is missing from revision history', async () => {
			const options = createTestCoreServices()
			const storedMemory = memory({ id: 'memory-1', title: 'Memory', currentRevisionId: 'missing-revision' })
			options.tx.memories.records.set(storedMemory.id, storedMemory)

			const result = await createGetMemoryQuery(options)({ memoryId: storedMemory.id })

			expect(result).toEqual({
				ok: false,
				error: { type: 'invariant-violation', message: 'Memory memory-1 current revision missing-revision is missing.' },
			})
		})

		it('returns storage errors when revision or child reads fail', async () => {
			const revisionReadFailure = createTestCoreServices()
			revisionReadFailure.tx.memories.records.set('memory-1', memory({ id: 'memory-1', title: 'Memory' }))
			revisionReadFailure.tx.memoryRevisions.fail.list = true
			await expect(createGetMemoryQuery(revisionReadFailure)({ memoryId: 'memory-1' })).resolves.toEqual({
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
				id: input.currentRevisionId ?? `${input.id}-revision`,
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
