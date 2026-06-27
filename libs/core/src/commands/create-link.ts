import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { linkPipe, type GraphNodeRef, type Link, type LinkType } from '../domain/graph'
import type {
	DuplicateLinkError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvalidLinkError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { auditStamp, createRecordValue, getRequired, listRecords, nextId, withTransaction } from './utils/storage'

const memoryNodeRefPipe = v.object({ type: v.eq('memory'), id: idPipe })
const createLinkTypePipe = v.in(['references', 'supports', 'contradicts', 'supersedes'])

export const inputPipe = v.object({
	type: createLinkTypePipe,
	from: memoryNodeRefPipe,
	to: memoryNodeRefPipe,
})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = linkPipe
export type Result = PipeOutput<typeof resultPipe>

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvalidLinkError
	| DuplicateLinkError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

type CreateLinkValues = {
	stamp: AuditStamp
	linkId: Id
}

export function createCreateLinkCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createLink', inputPipe, (input, context) => handleCreateLink(runtime, input, context))
}

async function handleCreateLink(runtime: CoreRuntime, input: Input, context: OperationContext): Promise<CoreResult<Result, Error>> {
	const values = createLinkValues(runtime, context)
	return values.ok ? withTransaction(runtime.services, (storage) => writeLink(storage, input, values.value)) : values
}

function createLinkValues(runtime: CoreRuntime, context: OperationContext): CoreResult<CreateLinkValues, InvalidCoreServiceOutputError> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return stamp

	const linkId = nextId(runtime.values, 'link')
	return linkId.ok ? { ok: true, value: { stamp: stamp.value, linkId: linkId.value } } : linkId
}

async function writeLink(
	storage: CoreStorage,
	input: Input,
	values: CreateLinkValues,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const validation = await validateCreateLink(storage, input)
	return validation.ok ? createRecordValue('link', storage, link(input, values)) : validation
}

async function validateCreateLink(
	storage: CoreStorage,
	input: Input,
): Promise<
	CoreResult<
		void,
		InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError | InvalidLinkError | DuplicateLinkError
	>
> {
	if (input.from.id === input.to.id) return invalidLink('self-link')

	const from = await getRequired('memory', storage, input.from.id)
	if (!from.ok) return from
	const to = await getRequired('memory', storage, input.to.id)
	if (!to.ok) return to

	return validateUniqueLink(storage, input)
}

async function validateUniqueLink(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<void, InvalidCoreServiceOutputError | StorageOperationFailedError | DuplicateLinkError>> {
	const existing = await listRecords('link', storage, {
		where: (filter, fields) => filter.eq(fields.type, input.type).eq(fields.from, input.from).eq(fields.to, input.to),
	})
	if (!existing.ok) return existing
	return existing.value.length === 0 ? { ok: true, value: undefined } : duplicateLink(input.type, input.from, input.to)
}

function link(input: Input, values: CreateLinkValues): Link {
	return {
		id: values.linkId,
		type: input.type,
		from: input.from,
		to: input.to,
		created: values.stamp,
		archivePeriods: [],
	}
}

function invalidLink(reason: InvalidLinkError['reason']): CoreResult<never, InvalidLinkError> {
	return { ok: false, error: { type: 'invalid-link', reason } }
}

function duplicateLink(linkType: LinkType, from: GraphNodeRef, to: GraphNodeRef): CoreResult<never, DuplicateLinkError> {
	return { ok: false, error: { type: 'duplicate-link', linkType, from, to } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('createLink command', () => {
		it('creates Memory-to-Memory association Links with local attribution', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-1')
			seedMemory(options, 'memory-2')
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{ type: 'supports', from: { type: 'memory', id: 'memory-1' }, to: { type: 'memory', id: 'memory-2' } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'link-1',
					type: 'supports',
					from: { type: 'memory', id: 'memory-1' },
					to: { type: 'memory', id: 'memory-2' },
					created: localStamp(),
					archivePeriods: [],
				},
			})
			expect(options.tx.links.records.get('link-1')).toEqual(result.ok ? result.value : null)
		})

		it('rejects unsupported Link types before opening storage', async () => {
			const options = createTestCoreServices()
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{ type: 'produced', from: { type: 'memory', id: 'memory-1' }, to: { type: 'memory', id: 'memory-2' } } as unknown as Input,
				context,
			)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', operation: 'createLink' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('rejects non-Memory endpoints before opening storage', async () => {
			const options = createTestCoreServices()
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					type: 'references',
					from: { type: 'project', id: 'project-1' },
					to: { type: 'memory', id: 'memory-1' },
				} as unknown as Input,
				context,
			)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', operation: 'createLink' } })
			expect(options.transactionCalls()).toBe(0)
		})

		it('rejects self-links', async () => {
			const options = createTestCoreServices()
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{ type: 'contradicts', from: { type: 'memory', id: 'memory-1' }, to: { type: 'memory', id: 'memory-1' } },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'invalid-link', reason: 'self-link' } })
			expect(options.tx.links.records.size).toBe(0)
		})

		it('returns not-found when either endpoint Memory is missing', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-1')
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{ type: 'references', from: { type: 'memory', id: 'memory-1' }, to: { type: 'memory', id: 'missing-memory' } },
				context,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'memory', id: 'missing-memory' } })
			expect(options.tx.links.records.size).toBe(0)
		})

		it('rejects duplicate exact Links across active and archived Links', async () => {
			const options = createTestCoreServices()
			seedMemory(options, 'memory-1')
			seedMemory(options, 'memory-2')
			options.tx.links.records.set('link-existing', {
				id: 'link-existing',
				type: 'references',
				from: { type: 'memory', id: 'memory-1' },
				to: { type: 'memory', id: 'memory-2' },
				created: stamp,
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const command = createCreateLinkCommand(createTestCoreRuntime(options))

			const result = await command(
				{ type: 'references', from: { type: 'memory', id: 'memory-1' }, to: { type: 'memory', id: 'memory-2' } },
				context,
			)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'duplicate-link',
					linkType: 'references',
					from: { type: 'memory', id: 'memory-1' },
					to: { type: 'memory', id: 'memory-2' },
				},
			})
			expect(options.tx.links.records.has('link-1')).toBe(false)
		})
	})

	function seedMemory(options: ReturnType<typeof createTestCoreServices>, id: string): void {
		options.tx.memories.records.set(id, { id, title: 'Memory', body: 'Body', type: 'fact', created: stamp })
	}
}
