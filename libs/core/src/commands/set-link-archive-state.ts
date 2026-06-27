import { v, type PipeOutput } from 'valleyed'

import { idPipe, type ArchivePeriod, type AuditStamp, type OperationContext } from '../domain/commons'
import { linkPipe, type Link, type LinkType } from '../domain/graph'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	LinkNotArchivableError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, isArchived, updateRecordValue, withAuditStampTransaction } from './utils/storage'

export const inputPipe = v.object({ linkId: idPipe, archived: v.boolean() })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = linkPipe
export type Result = PipeOutput<typeof resultPipe>

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| AlreadyArchivedError
	| NotArchivedError
	| LinkNotArchivableError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const archivableLinkTypes = new Set<LinkType>(['references', 'supports', 'contradicts'])

export function createSetLinkArchiveStateCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('setLinkArchiveState', inputPipe, (input, context) => setLinkArchiveState(runtime, context, input))
}

function setLinkArchiveState(
	runtime: CoreRuntime,
	context: OperationContext,
	input: Input,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(runtime, context, (storage, stamp) => setLinkArchiveStateInStorage(storage, input, stamp))
}

async function setLinkArchiveStateInStorage(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const existing = await getRequired('link', storage, input.linkId)
	if (!existing.ok) return existing

	const archivable = archivableLink(existing.value)
	if (!archivable.ok) return archivable

	return input.archived ? archiveStoredLink(storage, existing.value, stamp) : unarchiveStoredLink(storage, existing.value, stamp)
}

function archivableLink(link: Link): CoreResult<Link, LinkNotArchivableError> {
	return archivableLinkTypes.has(link.type) ? { ok: true, value: link } : linkNotArchivable(link.type)
}

function archiveStoredLink(
	storage: CoreStorage,
	link: Link,
	stamp: AuditStamp,
): Promise<
	CoreResult<
		Result,
		InvalidCoreServiceOutputError | InvariantViolationError | ResourceNotFoundError | StorageOperationFailedError | AlreadyArchivedError
	>
> {
	if (isArchived(link.archivePeriods)) return Promise.resolve(alreadyArchived(link.id))

	return updateLinkArchivePeriods(storage, link, [...link.archivePeriods, { archived: stamp, unarchived: null }])
}

function unarchiveStoredLink(
	storage: CoreStorage,
	link: Link,
	stamp: AuditStamp,
): Promise<
	CoreResult<
		Result,
		InvalidCoreServiceOutputError | InvariantViolationError | ResourceNotFoundError | StorageOperationFailedError | NotArchivedError
	>
> {
	if (!isArchived(link.archivePeriods)) return Promise.resolve(notArchived(link.id))

	const latestPeriodIndex = link.archivePeriods.length - 1
	const latestPeriod = link.archivePeriods[latestPeriodIndex] as ArchivePeriod
	const archivePeriods = [...link.archivePeriods]
	archivePeriods[latestPeriodIndex] = { ...latestPeriod, unarchived: stamp }
	return updateLinkArchivePeriods(storage, link, archivePeriods)
}

async function updateLinkArchivePeriods(
	storage: CoreStorage,
	link: Link,
	archivePeriods: ArchivePeriod[],
): Promise<
	CoreResult<Result, InvalidCoreServiceOutputError | InvariantViolationError | ResourceNotFoundError | StorageOperationFailedError>
> {
	const stored = await updateRecordValue('link', storage, link.id, { archivePeriods })
	return stored.ok ? { ok: true, value: stored.value } : stored
}

function alreadyArchived(linkId: string): CoreResult<never, AlreadyArchivedError> {
	return { ok: false, error: { type: 'already-archived', resource: 'link', id: linkId } }
}

function notArchived(linkId: string): CoreResult<never, NotArchivedError> {
	return { ok: false, error: { type: 'not-archived', resource: 'link', id: linkId } }
}

function linkNotArchivable(linkType: LinkType): CoreResult<never, LinkNotArchivableError> {
	return { ok: false, error: { type: 'link-not-archivable', linkType } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('setLinkArchiveState command', () => {
		it('archives archivable Links with local attribution', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'supports' })
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1', archived: true }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					...link({ type: 'supports' }),
					archivePeriods: [{ archived: localStamp(), unarchived: null }],
				},
			})
			expect(options.tx.links.records.get('link-1')).toEqual(result.ok ? result.value : null)
		})

		it('unarchives archived Links with local attribution', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'references', archived: true })
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1', archived: false }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					...link({ type: 'references' }),
					archivePeriods: [{ archived: stamp, unarchived: localStamp() }],
				},
			})
			expect(options.tx.links.records.get('link-1')).toEqual(result.ok ? result.value : null)
		})

		it('returns already-archived for archived Links when archiving', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'references', archived: true })
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1', archived: true }, context)

			expect(result).toEqual({ ok: false, error: { type: 'already-archived', resource: 'link', id: 'link-1' } })
		})

		it('returns not-archived for active Links when unarchiving', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'contradicts' })
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1', archived: false }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-archived', resource: 'link', id: 'link-1' } })
		})

		it('rejects immutable Supersedes Links', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'supersedes' })
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1', archived: true }, context)

			expect(result).toEqual({ ok: false, error: { type: 'link-not-archivable', linkType: 'supersedes' } })
			expect(options.tx.links.records.get('link-1')).toEqual(link({ type: 'supersedes' }))
		})

		it('returns not-found for missing Links', async () => {
			const command = createSetLinkArchiveStateCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command({ linkId: 'missing-link', archived: true }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'link', id: 'missing-link' } })
		})
	})

	function seedLink(options: ReturnType<typeof createTestCoreServices>, input: { type: LinkType; archived?: boolean }): void {
		options.tx.links.records.set('link-1', link(input))
	}

	function link(input: { type: LinkType; archived?: boolean }): Link {
		return {
			id: 'link-1',
			type: input.type,
			from: { type: 'memory', id: 'memory-1' },
			to: { type: 'memory', id: 'memory-2' },
			created: stamp,
			archivePeriods: input.archived ? [{ archived: stamp, unarchived: null }] : [],
		}
	}
}
