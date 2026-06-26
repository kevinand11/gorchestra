import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { type Link } from '../domain/graph'
import { memoryBodyPipe, memoryPipe, memoryTypePipe, type Memory } from '../domain/memory'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, nextId } from './utils/storage'

const createMemoryLinkPipe = v.discriminate((value) => value.type, {
	supersedes: v.object({ type: v.eq('supersedes'), toMemoryId: idPipe }),
})
export type CreateMemoryLink = PipeOutput<typeof createMemoryLinkPipe>

export const inputPipe = v.object({
	title: nonEmptyTrimmedStringPipe,
	body: memoryBodyPipe,
	type: v.nullable(memoryTypePipe),
	links: v.array(createMemoryLinkPipe).pipe(v.asSet<CreateMemoryLink>(createMemoryLinkKey)),
})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = memoryPipe
export type Result = PipeOutput<typeof resultPipe>

export type InvalidMemoryLinkError = { type: 'invalid-memory-link'; reason: 'self-supersession' }
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvalidMemoryLinkError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

type CreateMemoryValues = {
	stamp: AuditStamp
	memoryId: Id
	linkIds: Id[]
}

type CreateMemoryFacts = {
	memory: Memory
	links: Link[]
}

class TransactionRollbackError extends Error {
	constructor(readonly operationError: unknown) {
		super('Rollback Core transaction after operation error.')
	}
}

export function createCreateMemoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createMemory', inputPipe, (input, context) => handleCreateMemory(runtime, input, context))
}

function createMemoryLinkKey(link: CreateMemoryLink): string {
	return `${link.type}:${link.toMemoryId}`
}

async function handleCreateMemory(runtime: CoreRuntime, input: Input, context: OperationContext): Promise<CoreResult<Result, Error>> {
	const values = createMemoryValues(runtime, context, input.links.length)
	return values.ok ? withAtomicTransaction(runtime, (storage) => writeMemory(storage, input, values.value)) : values
}

async function withAtomicTransaction<TValue, TError>(
	runtime: CoreRuntime,
	run: (storage: CoreStorage) => Promise<CoreResult<TValue, TError>>,
): Promise<CoreResult<TValue, TError | StorageOperationFailedError>> {
	try {
		return await runtime.services.storage.session(async () => {
			const result = await run(runtime.services.storage)
			if (!result.ok) throw new TransactionRollbackError(result.error)
			return result
		})
	} catch (error) {
		return error instanceof TransactionRollbackError
			? { ok: false, error: error.operationError as TError }
			: { ok: false, error: { type: 'storage-operation-failed', operation: { type: 'transaction' } } }
	}
}

function createMemoryValues(
	runtime: CoreRuntime,
	context: OperationContext,
	linkCount: number,
): CoreResult<CreateMemoryValues, InvalidCoreServiceOutputError> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const memoryId = nextId(runtime.values, 'memory')
	if (!memoryId.ok) return memoryId

	const linkIds = nextLinkIds(runtime, linkCount)
	return linkIds.ok ? { ok: true, value: { stamp: stamp.value, memoryId: memoryId.value, linkIds: linkIds.value } } : linkIds
}

function nextLinkIds(runtime: CoreRuntime, linkCount: number): CoreResult<Id[], InvalidCoreServiceOutputError> {
	const ids: Id[] = []
	for (let index = 0; index < linkCount; index += 1) {
		const id = nextId(runtime.values, 'link')
		if (!id.ok) return id
		ids.push(id.value)
	}
	return { ok: true, value: ids }
}

async function writeMemory(
	storage: CoreStorage,
	input: Input,
	values: CreateMemoryValues,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const facts = await createMemoryFacts(storage, input, values)
	return facts.ok ? writeMemoryFacts(storage, facts.value) : facts
}

async function createMemoryFacts(
	storage: CoreStorage,
	input: Input,
	values: CreateMemoryValues,
): Promise<
	CoreResult<
		CreateMemoryFacts,
		InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError | InvalidMemoryLinkError
	>
> {
	const validation = await validateMemoryLinks(storage, values.memoryId, input.links)
	return validation.ok ? { ok: true, value: createMemoryFactsValue(input, values) } : validation
}

async function validateMemoryLinks(
	storage: CoreStorage,
	memoryId: Id,
	links: CreateMemoryLink[],
): Promise<CoreResult<void, InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError | InvalidMemoryLinkError>> {
	for (const link of links) {
		const validation = await validateMemoryLink(storage, memoryId, link)
		if (!validation.ok) return validation
	}
	return { ok: true, value: undefined }
}

async function validateMemoryLink(
	storage: CoreStorage,
	memoryId: Id,
	link: CreateMemoryLink,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError | InvalidMemoryLinkError>> {
	if (link.toMemoryId === memoryId) return invalidMemoryLink('self-supersession')

	const target = await getRequired('memory', storage, link.toMemoryId)
	return target.ok ? { ok: true, value: undefined } : target
}

function createMemoryFactsValue(input: Input, values: CreateMemoryValues): CreateMemoryFacts {
	const memory: Memory = { id: values.memoryId, title: input.title, body: input.body, type: input.type, created: values.stamp }
	return { memory, links: input.links.map((link, index) => supersedesLink(values, link, index)) }
}

function supersedesLink(values: CreateMemoryValues, link: CreateMemoryLink, index: number): Link {
	return {
		id: values.linkIds[index]!,
		type: 'supersedes',
		from: { type: 'memory', id: values.memoryId },
		to: { type: 'memory', id: link.toMemoryId },
		created: values.stamp,
		archivePeriods: [],
	}
}

async function writeMemoryFacts(
	storage: CoreStorage,
	facts: CreateMemoryFacts,
): Promise<CoreResult<Result, InvalidCoreServiceOutputError | InvariantViolationError | StorageOperationFailedError>> {
	const memory = await createRecordValue('memory', storage, facts.memory)
	return memory.ok ? writeMemoryLinks(storage, memory.value, facts.links) : memory
}

async function writeMemoryLinks(
	storage: CoreStorage,
	memory: Memory,
	links: Link[],
): Promise<CoreResult<Result, InvalidCoreServiceOutputError | InvariantViolationError | StorageOperationFailedError>> {
	for (const link of links) {
		const stored = await createRecordValue('link', storage, link)
		if (!stored.ok) return stored
	}
	return { ok: true, value: memory }
}

function invalidMemoryLink(reason: InvalidMemoryLinkError['reason']): CoreResult<never, InvalidMemoryLinkError> {
	return { ok: false, error: { type: 'invalid-memory-link', reason } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { getRecord } = await import('../storage/helpers')
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('createMemory command', () => {
		it('validates input before opening storage', async () => {
			const options = createTestCoreServices()
			options.tx.memories.fail.put = true
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command({ title: '', body: '', type: null, links: [] }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'createMemory' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('creates a Standalone Memory with local attribution and returns the raw Memory', async () => {
			const options = createTestCoreServices()
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: '  Route contracts  ', body: 'Keep the client facade typed.', type: 'convention', links: [] },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'memory-1',
					title: 'Route contracts',
					body: 'Keep the client facade typed.',
					type: 'convention',
					created: localStamp(),
				},
			})
			expect(options.tx.memories.records.get('memory-1')).toEqual(result.ok ? result.value : null)
			expect(options.tx.links.records.size).toBe(0)
		})

		it('normalizes whitespace-only bodies to empty strings while preserving nonblank body text', async () => {
			const options = createTestCoreServices()
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const blank = await command({ title: 'Blank', body: '   ', type: null, links: [] }, context)
			const spaced = await command({ title: 'Spaced', body: '  keep spaces  ', type: null, links: [] }, context)

			expect(blank).toMatchObject({ ok: true, value: { body: '' } })
			expect(spaced).toMatchObject({ ok: true, value: { body: '  keep spaces  ' } })
		})

		it('creates Supersedes Links in the same transaction but still returns only the raw Memory', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-old')
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: 'New convention', body: '', type: 'convention', links: [{ type: 'supersedes', toMemoryId: 'memory-old' }] },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: { id: 'memory-1', title: 'New convention', body: '', type: 'convention', created: localStamp() },
			})
			expect(options.tx.links.records.get('link-1')).toEqual({
				id: 'link-1',
				type: 'supersedes',
				from: { type: 'memory', id: 'memory-1' },
				to: { type: 'memory', id: 'memory-old' },
				created: localStamp(),
				archivePeriods: [],
			})
		})

		it('dedupes duplicate Supersedes Link targets before writing', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-old')
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					title: 'New convention',
					body: '',
					type: null,
					links: [
						{ type: 'supersedes', toMemoryId: 'memory-old' },
						{ type: 'supersedes', toMemoryId: 'memory-old' },
					],
				},
				context,
			)

			expect(result).toMatchObject({ ok: true, value: { id: 'memory-1' } })
			expect([...options.tx.links.records.values()]).toEqual([
				{
					id: 'link-1',
					type: 'supersedes',
					from: { type: 'memory', id: 'memory-1' },
					to: { type: 'memory', id: 'memory-old' },
					created: localStamp(),
					archivePeriods: [],
				},
			])
		})

		it('fails without creating a Memory when the Superseded Memory does not exist', async () => {
			const options = createTestCoreServices()
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: 'New convention', body: '', type: null, links: [{ type: 'supersedes', toMemoryId: 'missing-memory' }] },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: 'missing-memory' } })
			expect(options.tx.memories.records.size).toBe(0)
			expect(options.tx.links.records.size).toBe(0)
		})

		it('rejects detected self-supersession', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-1')
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: 'New convention', body: '', type: null, links: [{ type: 'supersedes', toMemoryId: 'memory-1' }] },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'invalid-memory-link', reason: 'self-supersession' } })
			expect(options.tx.memories.records.get('memory-1')).toEqual(existingMemory('memory-1'))
			expect(options.tx.links.records.size).toBe(0)
		})

		it('returns storage errors without writing partial Memory or Link facts', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-old')
			options.tx.links.fail.put = true
			const command = createCreateMemoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ title: 'New convention', body: '', type: null, links: [{ type: 'supersedes', toMemoryId: 'memory-old' }] },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'create', resource: 'link', id: 'link-1' } },
			})
			expect(await getRecord('memory', options.storage, 'memory-1')).toEqual({ ok: true, value: null })
			expect(await getRecord('link', options.storage, 'link-1')).toEqual({ ok: true, value: null })
		})
	})

	function seedMemory(options: ReturnType<typeof createTestCoreServices>, id: string): void {
		options.tx.memories.records.set(id, existingMemory(id))
	}

	function existingMemory(id: string): Memory {
		return { id, title: 'Existing Memory', body: 'Existing body', type: 'decision', created: stamp }
	}
}
