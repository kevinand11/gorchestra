import { OrmValidationError, type FilterGroup, type SchemaFields } from 'equipped/orm'
import { PipeError } from 'valleyed'

import type { PaginatedQueryEnvelope, ParsedPaginatedQueryInput } from '../domain/commons'
import type {
	CoreIdResource,
	CoreResource,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import {
	coreIdResourceSchemas,
	coreResourceSchemas,
	type CoreIdStorageRecord,
	type CoreStorageRecord,
	withExplicitCoreStorageId,
} from './schemas'
import type { Result } from '../utils/types'

export { withTransaction, withTwoPhaseTransaction } from './transactions'

export type StorageBoundaryError = StorageOperationFailedError | InvalidCoreServiceOutputError

export async function getRecord<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	id: string,
): Promise<Result<CoreIdStorageRecord<Resource> | null, StorageBoundaryError>> {
	try {
		const record = await storage
			.on(coreIdResourceSchemas[resource])
			.one()
			.id(id as never)
			.find()
		return { ok: true, value: record as unknown as CoreIdStorageRecord<Resource> | null }
	} catch (error) {
		return readStorageError(resource, { type: 'get', resource, id }, error)
	}
}

export async function getRequired<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	id: string,
): Promise<Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | ResourceNotFoundError>> {
	const record = await getRecord(resource, storage, id)
	if (!record.ok) return record

	return record.value === null ? notFound(resource, id) : { ok: true, value: record.value }
}

type CoreIdResourceSchema<Resource extends CoreIdResource> = (typeof coreIdResourceSchemas)[Resource]

type ListRecordsWhere<Resource extends CoreIdResource> = (
	filter: FilterGroup,
	fields: SchemaFields<CoreIdResourceSchema<Resource>>,
) => FilterGroup

export interface ListRecordsOrderBy<Resource extends CoreIdResource> {
	field: keyof CoreIdStorageRecord<Resource> & string
	direction?: 'asc' | 'desc'
}

export interface ListRecordsOptions<Resource extends CoreIdResource> {
	where?: ListRecordsWhere<Resource>
	orderBy?: ListRecordsOrderBy<Resource>[]
	limit?: number
}

interface PaginatedListQuery {
	orderBy(field: string, direction?: 'asc' | 'desc'): PaginatedListQuery
	limit(limit: number): PaginatedListQuery
	page(page: number): PaginatedListQuery
	paginate(): Promise<unknown>
}

export async function listRecords<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	options: ListRecordsOptions<Resource> = {},
): Promise<Result<Array<CoreIdStorageRecord<Resource>>, StorageBoundaryError>> {
	try {
		const schema = coreIdResourceSchemas[resource]
		const records = await listRecordsQuery(storage, schema, options).find()
		return { ok: true, value: records as unknown as Array<CoreIdStorageRecord<Resource>> }
	} catch (error) {
		return readStorageError(resource, { type: 'list', resource }, error)
	}
}

export async function listRecordsPaginated<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	pagination: ParsedPaginatedQueryInput,
	options: Pick<ListRecordsOptions<Resource>, 'where'> = {},
): Promise<Result<PaginatedQueryEnvelope<CoreIdStorageRecord<Resource>>, StorageBoundaryError>> {
	try {
		const schema = coreIdResourceSchemas[resource]
		const where = boundedListRecordsWhere(options.where, pagination.beforeId)
		const queryOptions = where === undefined ? {} : { where }
		const baseQuery: PaginatedListQuery = listRecordsQuery(storage, schema, queryOptions)
		let query = baseQuery.orderBy('id', 'desc')
		if (pagination.limit !== undefined) query = query.limit(pagination.limit)
		if ('page' in pagination && pagination.page !== undefined) query = query.page(pagination.page)
		const page = await query.paginate()
		return { ok: true, value: page as PaginatedQueryEnvelope<CoreIdStorageRecord<Resource>> }
	} catch (error) {
		return readStorageError(resource, { type: 'list', resource }, error)
	}
}

function listRecordsQuery<Resource extends CoreIdResource>(
	storage: CoreStorage,
	schema: CoreIdResourceSchema<Resource>,
	options: ListRecordsOptions<Resource>,
) {
	const query =
		options.where === undefined
			? storage.on(schema).all()
			: storage
					.on(schema)
					.all()
					.where((filter) => options.where?.(filter, schema.fields as SchemaFields<CoreIdResourceSchema<Resource>>) ?? filter)

	return applyListRecordsLimit(applyListRecordsOrdering(query, options.orderBy ?? []), options.limit)
}

function boundedListRecordsWhere<Resource extends CoreIdResource>(
	where: ListRecordsWhere<Resource> | undefined,
	beforeId: string | undefined,
): ListRecordsWhere<Resource> | undefined {
	if (beforeId === undefined) return where
	return (filter, fields) => (where?.(filter, fields) ?? filter).lt(fields.id, beforeId)
}

function applyListRecordsOrdering<
	Resource extends CoreIdResource,
	TQuery extends { orderBy(field: string, direction?: 'asc' | 'desc'): TQuery },
>(query: TQuery, orderBy: readonly ListRecordsOrderBy<Resource>[]): TQuery {
	return orderBy.reduce((ordered, order) => ordered.orderBy(order.field, order.direction), query)
}

function applyListRecordsLimit<TQuery extends { limit(limit: number): TQuery }>(query: TQuery, limit: number | undefined): TQuery {
	return limit === undefined ? query : query.limit(limit)
}

export async function createRecord<Resource extends CoreResource>(
	resource: Resource,
	storage: CoreStorage,
	record: CoreStorageRecord<Resource>,
): Promise<Result<CoreStorageRecord<Resource>, StorageOperationFailedError | InvariantViolationError>> {
	try {
		const created = await withExplicitCoreStorageId(recordId(record), () =>
			storage
				.on(coreResourceSchemas[resource])
				.one()
				.create(record as never),
		)
		return { ok: true, value: created as unknown as CoreStorageRecord<Resource> }
	} catch (error) {
		return writeStorageError(resource, { type: 'create', resource, id: recordId(record) }, error)
	}
}

export async function updateRecord<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	id: string,
	patch: Partial<CoreIdStorageRecord<Resource>>,
): Promise<Result<CoreIdStorageRecord<Resource>, StorageOperationFailedError | InvariantViolationError | ResourceNotFoundError>> {
	try {
		const updated = await storage
			.on(coreIdResourceSchemas[resource])
			.one()
			.id(id as never)
			.update(patch as never)
		return updated === null ? notFound(resource, id) : { ok: true, value: updated as unknown as CoreIdStorageRecord<Resource> }
	} catch (error) {
		return writeStorageError(resource, { type: 'update', resource, id }, error)
	}
}

export function notFound(resource: CoreIdResource, id: string): Result<never, ResourceNotFoundError> {
	return { ok: false, error: { type: 'not-found', resource, id } }
}

function readStorageError<TValue>(
	resource: CoreResource,
	operation: StorageOperationFailedError['operation'],
	error: unknown,
): Result<TValue, StorageBoundaryError> {
	return error instanceof OrmValidationError
		? { ok: false, error: invalidStorageOutput(resource, operation.type) }
		: { ok: false, error: storageFailure(operation) }
}

function writeStorageError<TValue>(
	resource: CoreResource,
	operation: StorageOperationFailedError['operation'],
	error: unknown,
): Result<TValue, StorageOperationFailedError | InvariantViolationError> {
	return error instanceof OrmValidationError
		? { ok: false, error: { type: 'invariant-violation', message: `Core built invalid ${resource} storage data.` } }
		: { ok: false, error: storageFailure(operation) }
}

function invalidStorageOutput(resource: CoreResource, operation: string): InvalidCoreServiceOutputError {
	return {
		type: 'invalid-core-service-output',
		service: 'storage',
		operation: `${operation}:${resource}`,
		pipeError: PipeError.root('Stored Core record failed schema validation.', null),
	}
}

function storageFailure(operation: StorageOperationFailedError['operation']): StorageOperationFailedError {
	return { type: 'storage-operation-failed', operation }
}

function recordId(record: unknown): string {
	return typeof record === 'object' && record !== null && typeof (record as { id?: unknown }).id === 'string'
		? (record as { id: string }).id
		: ''
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('listRecords', () => {
		it('passes filters to the storage adapter', async () => {
			const options = createTestCoreServices()
			const matching = {
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				config: { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
				created: localStamp(),
			}
			options.tx.repositories.records.set(matching.id, matching)
			options.tx.repositories.records.set('01k00000000000000000000035', {
				id: '01k00000000000000000000035',
				projectId: '01k00000000000000000000031',
				config: { provider: 'github', owner: 'Octo', name: 'Other', secretId: '01k00000000000000000000040' },
				created: localStamp(),
			})

			const result = await listRecords('repository', options.storage, {
				where: (filter, fields) => filter.eq(fields.projectId, '01k00000000000000000000030'),
			})

			expect(result).toEqual({ ok: true, value: [matching] })
		})

		it('applies ordering and limits to storage adapter reads', async () => {
			const options = createTestCoreServices()
			const first = agentRunEvent('01k00000000000000000000003', 1)
			const second = agentRunEvent('01k00000000000000000000004', 2)
			const third = agentRunEvent('01k00000000000000000000005', 3)
			options.tx.agentRunEvents.records.set(third.id, third)
			options.tx.agentRunEvents.records.set(first.id, first)
			options.tx.agentRunEvents.records.set(second.id, second)

			const result = await listRecords('agent-run-event', options.storage, {
				where: (filter, fields) => filter.eq(fields.agentRunId, '01k00000000000000000000002'),
				orderBy: [{ field: 'id', direction: 'asc' }],
				limit: 2,
			})

			expect(result).toEqual({ ok: true, value: [first, second] })
		})
	})

	function agentRunEvent(id: string, sequence: number) {
		return {
			id,
			agentRunId: '01k00000000000000000000002',
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message' as const,
				source: { type: 'runtime' as const },
				parts: [{ type: 'text' as const, text: `event ${sequence}`, metadata: null }],
			},
		}
	}
}
