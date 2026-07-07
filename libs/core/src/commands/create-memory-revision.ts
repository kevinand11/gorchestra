import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
import { memoryBodyPipe, memoryPipe, memoryTitlePipe, type CurrentMemoryRevision, type Memory, type MemoryRevision } from '../domain/memory'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	RevisionConflictError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, nextId, updateRecordValue, withTransaction } from './utils/storage'

export const inputPipe = v.object({
	memoryId: idPipe,
	expectedCurrentRevisionId: idPipe,
	title: memoryTitlePipe,
	body: memoryBodyPipe,
})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = memoryPipe
export type Result = PipeOutput<typeof resultPipe>

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| RevisionConflictError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

type CreateMemoryRevisionValues = {
	revisionId: Id
	stamp: AuditStamp
}

export function createCreateMemoryRevisionCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createMemoryRevision', inputPipe, (input, context) => handleCreateMemoryRevision(runtime, input, context))
}

function handleCreateMemoryRevision(runtime: CoreRuntime, input: Input, context: CommandContext): Promise<CoreResult<Result, Error>> {
	return withTransaction(runtime.services, (storage) => createRevisionInStorage(storage, runtime, input, context))
}

async function createRevisionInStorage(
	storage: CoreStorage,
	runtime: CoreRuntime,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const memory = await getRequired('memory', storage, input.memoryId)
	return memory.ok ? createRevisionForMemory(storage, runtime, memory.value, input, context) : memory
}

function createRevisionForMemory(
	storage: CoreStorage,
	runtime: CoreRuntime,
	memory: Memory,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const conflict = validateExpectedRevision(memory, input)
	if (!conflict.ok) return Promise.resolve(conflict)
	if (unchanged(memory, input)) return Promise.resolve({ ok: true, value: memory })

	return createChangedRevision(storage, runtime, memory, input, context)
}

function createChangedRevision(
	storage: CoreStorage,
	runtime: CoreRuntime,
	memory: Memory,
	input: Input,
	context: CommandContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const values = createMemoryRevisionValues(runtime, context)
	return values.ok ? writeMemoryRevision(storage, memory, input, values.value) : Promise.resolve(values)
}

function validateExpectedRevision(memory: Memory, input: Input): CoreResult<void, RevisionConflictError> {
	return memory.currentRevision.id === input.expectedCurrentRevisionId
		? { ok: true, value: undefined }
		: {
				ok: false,
				error: {
					type: 'revision-conflict',
					memoryId: memory.id,
					expectedCurrentRevisionId: input.expectedCurrentRevisionId,
					actualCurrentRevisionId: memory.currentRevision.id,
				},
			}
}

function unchanged(memory: Memory, input: Input): boolean {
	return input.title === memory.currentRevision.title && input.body === memory.currentRevision.body
}

function createMemoryRevisionValues(
	runtime: CoreRuntime,
	context: CommandContext,
): CoreResult<CreateMemoryRevisionValues, InvalidCoreServiceOutputError> {
	const revisionId = nextId(runtime.values)
	if (!revisionId.ok) return revisionId

	const stamp = auditStamp(runtime.values, context)
	return stamp.ok ? { ok: true, value: { revisionId: revisionId.value, stamp: stamp.value } } : stamp
}

async function writeMemoryRevision(
	storage: CoreStorage,
	memory: Memory,
	input: Input,
	values: CreateMemoryRevisionValues,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const revision = memoryRevision(memory.id, input, values)
	const storedRevision = await createRecordValue('memory-revision', storage, revision)
	if (!storedRevision.ok) return storedRevision

	return updateRecordValue('memory', storage, memory.id, { currentRevision: currentRevision(storedRevision.value) })
}

function memoryRevision(memoryId: Id, input: Input, values: CreateMemoryRevisionValues): MemoryRevision {
	return { id: values.revisionId, memoryId, title: input.title, body: input.body, created: values.stamp }
}

function currentRevision(revision: MemoryRevision): CurrentMemoryRevision {
	return { id: revision.id, title: revision.title, body: revision.body, created: revision.created }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('createMemoryRevision command', () => {
		it('validates input before opening storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.get = true
			const command = createCreateMemoryRevisionCommand(createTestCoreRuntime(options))

			const result = await command(
				{ memoryId: '', expectedCurrentRevisionId: '01k00000000000000000000038', title: 'Title', body: '' },
				context,
			)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'createMemoryRevision' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a revision and updates the Memory current revision snapshot', async () => {
			const options = createTestCoreServices()
			seedMemory(options, '01k00000000000000000000019')
			const command = createCreateMemoryRevisionCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					memoryId: '01k00000000000000000000019',
					expectedCurrentRevisionId: '01k00000000000000000100010',
					title: '  Updated  ',
					body: '  Body  ',
				},
				context,
			)

			const revision: MemoryRevision = {
				id: '01k00000000000000000010001',
				memoryId: '01k00000000000000000000019',
				title: 'Updated',
				body: 'Body',
				created: localStamp(),
			}
			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000019',
					parentId: null,
					created: stamp,
					currentRevision: currentRevision(revision),
				},
			})
			expect(options.tx.memoryRevisions.records.get(revision.id)).toEqual(revision)
			expect(options.tx.memories.records.get('01k00000000000000000000019')).toEqual(result.ok ? result.value : null)
		})

		it('returns the existing Memory without creating a revision when canonical title and body are unchanged', async () => {
			const options = createTestCoreServices()
			const memory = seedMemory(options, '01k00000000000000000000019')
			const command = createCreateMemoryRevisionCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					memoryId: '01k00000000000000000000019',
					expectedCurrentRevisionId: '01k00000000000000000100010',
					title: '  Current  ',
					body: '  Current body  ',
				},
				context,
			)

			expect(result).toEqual({ ok: true, value: memory })
			expect(options.tx.memoryRevisions.records.size).toBe(0)
		})

		it('rejects stale expected current revision ids with revision-conflict', async () => {
			const options = createTestCoreServices()
			seedMemory(options, '01k00000000000000000000019')
			const command = createCreateMemoryRevisionCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					memoryId: '01k00000000000000000000019',
					expectedCurrentRevisionId: '01k00000000000000000010020',
					title: 'Updated',
					body: '',
				},
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'revision-conflict',
					memoryId: '01k00000000000000000000019',
					expectedCurrentRevisionId: '01k00000000000000000010020',
					actualCurrentRevisionId: '01k00000000000000000100010',
				},
			})
			expect(options.tx.memoryRevisions.records.size).toBe(0)
		})

		it('returns not-found when the target Memory is missing', async () => {
			const command = createCreateMemoryRevisionCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command(
				{
					memoryId: '01k00000000000000000010021',
					expectedCurrentRevisionId: '01k00000000000000000000038',
					title: 'Updated',
					body: '',
				},
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: '01k00000000000000000010021' } })
		})
	})

	function seedMemory(options: ReturnType<typeof createTestCoreServices>, id: string): Memory {
		const memory: Memory = {
			id,
			parentId: null,
			created: stamp,
			currentRevision: { id: '01k00000000000000000100010', title: 'Current', body: 'Current body', created: stamp },
		}
		options.tx.memories.records.set(id, memory)
		return memory
	}
}
