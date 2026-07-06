import { v, type PipeOutput } from 'valleyed'

import { memoryBodyPipe, memoryPipe, memoryTitlePipe, type CurrentMemoryRevision, type Memory, type MemoryRevision } from '../domain/memory'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { CommandContext } from './types'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, nextId, withTransaction } from './utils/storage'
import type { AuditStamp, Id } from '../domain/commons'

export const inputPipe = v.object({ parentId: v.nullable(v.string()), title: memoryTitlePipe, body: memoryBodyPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = memoryPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ResourceNotFoundError
	| StorageOperationFailedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type CreateMemoryValues = {
	memoryId: Id
	revisionId: Id
	stamp: AuditStamp
}

export function createCreateMemoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createMemory', inputPipe, (input, context) => handleCreateMemory(runtime, input, context))
}

function handleCreateMemory(runtime: CoreRuntime, input: Input, context: CommandContext): Promise<CoreResult<Result, Error>> {
	return withTransaction(runtime.services, async (storage) => {
		const parent = await validateParent(storage, input.parentId)
		if (!parent.ok) return parent

		const values = createMemoryValues(runtime, context)
		return values.ok ? writeMemory(storage, input, values.value) : values
	})
}

async function validateParent(
	storage: CoreStorage,
	parentId: Id | null,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError>> {
	if (parentId === null) return { ok: true, value: undefined }
	const parent = await getRequired('memory', storage, parentId)
	return parent.ok ? { ok: true, value: undefined } : parent
}

function createMemoryValues(runtime: CoreRuntime, context: CommandContext): CoreResult<CreateMemoryValues, InvalidCoreServiceOutputError> {
	const memoryId = nextId(runtime.values)
	if (!memoryId.ok) return memoryId

	const revisionId = nextId(runtime.values)
	if (!revisionId.ok) return revisionId

	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? { ok: true, value: { memoryId: memoryId.value, revisionId: revisionId.value, stamp: stamp.value } } : stamp
}

async function writeMemory(
	storage: CoreStorage,
	input: Input,
	values: CreateMemoryValues,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revision = memoryRevision(input, values)
	const storedRevision = await createRecordValue('memory-revision', storage, revision)
	if (!storedRevision.ok) return storedRevision

	const memory = memoryRecord(input, values, currentRevision(storedRevision.value))
	return createRecordValue('memory', storage, memory)
}

function memoryRevision(input: Input, values: CreateMemoryValues): MemoryRevision {
	return {
		id: values.revisionId,
		memoryId: values.memoryId,
		title: input.title,
		body: input.body,
		created: values.stamp,
	}
}

function memoryRecord(input: Input, values: CreateMemoryValues, revision: CurrentMemoryRevision): Memory {
	return { id: values.memoryId, parentId: input.parentId, created: values.stamp, currentRevision: revision }
}

function currentRevision(revision: MemoryRevision): CurrentMemoryRevision {
	return { id: revision.id, title: revision.title, body: revision.body, created: revision.created }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('createMemory command', () => {
		it('validates input before opening storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.get = true
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ parentId: null, title: '', body: '' }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'createMemory' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a root Memory and first revision with local attribution', async () => {
			const options = createTestCoreServices()
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ parentId: null, title: '  Brain  ', body: '  Body  ' }, context)

			const revision: MemoryRevision = {
				id: '01k00000000000000000010002',
				memoryId: '01k00000000000000000010001',
				title: 'Brain',
				body: 'Body',
				created: localStamp(),
			}
			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					parentId: null,
					created: localStamp(),
					currentRevision: currentRevision(revision),
				},
			})
			expect(options.tx.memoryRevisions.records.get(revision.id)).toEqual(revision)
			expect(options.tx.memories.records.get('01k00000000000000000010001')).toEqual(result.ok ? result.value : null)
		})

		it('creates a child Memory after validating the parent exists', async () => {
			const options = createTestCoreServices()
			seedMemory(options, '01k00000000000000000010020')
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ parentId: '01k00000000000000000010020', title: 'Child', body: '' }, context)

			expect(result).toMatchObject({ ok: true, value: { id: '01k00000000000000000010001', parentId: '01k00000000000000000010020' } })
		})

		it('rejects missing parent Memories before generating ids', async () => {
			const options = createTestCoreServices()
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ parentId: '01k00000000000000000100054', title: 'Child', body: '' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: '01k00000000000000000100054' } })
			expect(options.tx.memoryRevisions.records.size).toBe(0)
			expect(options.tx.memories.records.size).toBe(0)
		})

		it('returns storage errors when revision creation fails', async () => {
			const options = createTestCoreServices()
			options.tx.memoryRevisions.fail.put = true
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ parentId: null, title: 'Memory', body: '' }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'storage-operation-failed',
					operation: { type: 'create', resource: 'memory-revision', id: '01k00000000000000000010002' },
				},
			})
			expect(options.tx.memories.records.size).toBe(0)
		})
	})

	function seedMemory(options: ReturnType<typeof createTestCoreServices>, id: string): void {
		options.tx.memories.records.set(id, {
			id,
			parentId: null,
			created: stamp,
			currentRevision: { id: '01k00000000000000000010021', title: 'Parent', body: '', created: stamp },
		})
	}
}
