import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { memoryPipe, type Memory } from '../domain/memory'
import { memoryBodyPipe, memoryTitlePipe, type MemoryRevision } from '../domain/memory-revision'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	RevisionConflictError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, nextId, updateRecordValue, withTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

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

export function createCreateMemoryRevisionCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createMemoryRevision', inputPipe, (input, context) =>
		withTransaction<Result, Exclude<Error, InvalidInputError>>(runtime.services, async (storage) => {
			const memory = await getRequired('memory', storage, input.memoryId)
			if (!memory.ok) return memory
			if (memory.value.currentRevision.id !== input.expectedCurrentRevisionId) {
				return {
					ok: false,
					error: {
						type: 'revision-conflict',
						memoryId: memory.value.id,
						expectedCurrentRevisionId: input.expectedCurrentRevisionId,
						actualCurrentRevisionId: memory.value.currentRevision.id,
					},
				}
			}
			if (input.title === memory.value.currentRevision.title && input.body === memory.value.currentRevision.body) {
				return { ok: true, value: memory.value }
			}

			const revisionId = nextId(runtime.values)
			if (!revisionId.ok) return revisionId

			const stamp = auditStamp(runtime.values, context)
			if (!stamp.ok) return stamp

			const storedRevision = await createRecordValue('memory-revision', storage, {
				id: revisionId.value,
				memoryId: memory.value.id,
				title: input.title,
				body: input.body,
				created: stamp.value,
			})
			if (!storedRevision.ok) return storedRevision

			return updateRecordValue('memory', storage, memory.value.id, {
				currentRevision: {
					id: storedRevision.value.id,
					title: storedRevision.value.title,
					body: storedRevision.value.body,
					created: storedRevision.value.created,
				},
			})
		}),
	)
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
					currentRevision: {
						id: revision.id,
						title: revision.title,
						body: revision.body,
						created: revision.created,
					},
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
