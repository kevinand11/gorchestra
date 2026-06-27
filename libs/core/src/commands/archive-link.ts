import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type OperationContext } from '../domain/commons'
import { linkPipe, type Link, type LinkType } from '../domain/graph'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	LinkNotArchivableError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { getRequired, isArchived, updateRecordValue, withAuditStampTransaction } from './utils/storage'

export const inputPipe = v.object({ linkId: idPipe })
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
	| LinkNotArchivableError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const archivableLinkTypes = new Set<LinkType>(['references', 'supports', 'contradicts'])

export function createArchiveLinkCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveLink', inputPipe, (input, context) => archiveLink(runtime, context, input.linkId))
}

function archiveLink(
	runtime: CoreRuntime,
	context: OperationContext,
	linkId: string,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(runtime, context, (storage, stamp) => archiveLinkInStorage(storage, linkId, stamp))
}

async function archiveLinkInStorage(
	storage: CoreStorage,
	linkId: string,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const existing = await getRequired('link', storage, linkId)
	if (!existing.ok) return existing

	const archivable = archivableLink(existing.value)
	if (!archivable.ok) return archivable
	if (isArchived(existing.value.archivePeriods)) return alreadyArchived(linkId)

	return updateArchivedLink(storage, existing.value, stamp)
}

function archivableLink(link: Link): CoreResult<Link, LinkNotArchivableError> {
	return archivableLinkTypes.has(link.type) ? { ok: true, value: link } : linkNotArchivable(link.type)
}

function updateArchivedLink(
	storage: CoreStorage,
	link: Link,
	stamp: AuditStamp,
): Promise<
	CoreResult<Result, InvalidCoreServiceOutputError | InvariantViolationError | ResourceNotFoundError | StorageOperationFailedError>
> {
	const archivePeriods = [...link.archivePeriods, { archived: stamp, unarchived: null }]
	const archived: Link = { ...link, archivePeriods }
	return updateRecordValue('link', storage, link.id, { archivePeriods }).then((stored) =>
		stored.ok ? { ok: true, value: archived } : stored,
	)
}

function alreadyArchived(linkId: string): CoreResult<never, AlreadyArchivedError> {
	return { ok: false, error: { type: 'already-archived', resource: 'link', id: linkId } }
}

function linkNotArchivable(linkType: LinkType): CoreResult<never, LinkNotArchivableError> {
	return { ok: false, error: { type: 'link-not-archivable', linkType } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, stamp } = await import('../utils/test-helpers')

	describe('archiveLink command', () => {
		it('archives archivable Links with local attribution', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'supports' })
			const command = createArchiveLinkCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					...link({ type: 'supports' }),
					archivePeriods: [{ archived: localStamp(), unarchived: null }],
				},
			})
			expect(options.tx.links.records.get('link-1')).toEqual(result.ok ? result.value : null)
		})

		it('returns already-archived for archived Links', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'references', archived: true })
			const command = createArchiveLinkCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'already-archived', resource: 'link', id: 'link-1' } })
		})

		it('rejects immutable Supersedes Links', async () => {
			const options = createTestCoreServices()
			seedLink(options, { type: 'supersedes' })
			const command = createArchiveLinkCommand(createTestCoreRuntime(options))

			const result = await command({ linkId: 'link-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'link-not-archivable', linkType: 'supersedes' } })
			expect(options.tx.links.records.get('link-1')).toEqual(link({ type: 'supersedes' }))
		})

		it('returns not-found for missing Links', async () => {
			const command = createArchiveLinkCommand(createTestCoreRuntime(createTestCoreServices()))

			const result = await command({ linkId: 'missing-link' }, context)

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
