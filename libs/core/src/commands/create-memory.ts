import { v, type PipeOutput } from 'valleyed'

import { memoryPipe } from '../domain/memory'
import { memoryBodyPipe, memoryTitlePipe, type MemoryRevision } from '../domain/memory-revision'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CommandContext } from './types'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, nextId } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

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

export function createCreateMemoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createMemory', inputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run<Result, Exclude<Error, InvalidInputError>>(async ({ storage }) => {
			if (input.parentId !== null) {
				const parent = await getRequired('memory', storage, input.parentId)
				if (!parent.ok) return parent
			}

			const memoryId = nextId(runtime.values)
			if (!memoryId.ok) return memoryId

			const revisionId = nextId(runtime.values)
			if (!revisionId.ok) return revisionId

			const storedRevision = await createRecordValue('memory-revision', storage, {
				id: revisionId.value,
				memoryId: memoryId.value,
				title: input.title,
				body: input.body,
				created: stamp.value,
			})
			if (!storedRevision.ok) return storedRevision

			return createRecordValue('memory', storage, {
				id: memoryId.value,
				parentId: input.parentId,
				created: stamp.value,
				currentRevision: {
					id: storedRevision.value.id,
					title: storedRevision.value.title,
					body: storedRevision.value.body,
					created: storedRevision.value.created,
				},
			})
		})
	})
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
					currentRevision: {
						id: revision.id,
						title: revision.title,
						body: revision.body,
						created: revision.created,
					},
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
