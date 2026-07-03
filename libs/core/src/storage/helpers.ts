import { OrmValidationError, type FilterGroup, type SchemaFields } from 'equipped/orm'
import { PipeError } from 'valleyed'

import type {
	CoreIdResource,
	CoreResource,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import {
	coreIdResourceSchemas,
	coreResourceSchemas,
	portfolioConfigSchema,
	portfolioConfigStorageId,
	type CoreIdStorageRecord,
	type CoreStorageRecord,
	withExplicitCoreStorageId,
} from './schemas'
import type { Result } from '../utils/types'

export { withTransaction, withTwoPhaseTransaction } from './transactions'

export type StorageBoundaryError = StorageOperationFailedError | InvalidCoreServiceOutputError

export async function getPortfolioConfig(
	storage: CoreStorage,
): Promise<Result<CoreStorageRecord<'portfolio-config'> | null, StorageBoundaryError>> {
	try {
		const record = await storage.on(portfolioConfigSchema).one().id(portfolioConfigStorageId).find()
		return { ok: true, value: record }
	} catch (error) {
		return readStorageError('portfolio-config', { type: 'get', resource: 'portfolio-config', id: null }, error)
	}
}

export async function getRequiredPortfolioConfig(
	storage: CoreStorage,
): Promise<Result<CoreStorageRecord<'portfolio-config'>, StorageBoundaryError | SingletonNotFoundError>> {
	const record = await getPortfolioConfig(storage)
	if (!record.ok) return record

	return record.value === null
		? { ok: false, error: { type: 'not-found-singleton', resource: 'portfolio-config' } }
		: { ok: true, value: record.value }
}

export async function setPortfolioConfig(
	storage: CoreStorage,
	record: Omit<CoreStorageRecord<'portfolio-config'>, 'id'>,
): Promise<Result<CoreStorageRecord<'portfolio-config'>, StorageBoundaryError | InvariantViolationError>> {
	const existing = await getPortfolioConfig(storage)
	if (!existing.ok) return existing

	return existing.value === null ? createPortfolioConfigRecord(storage, record) : updatePortfolioConfigRecord(storage, record)
}

function createPortfolioConfigRecord(
	storage: CoreStorage,
	record: Omit<CoreStorageRecord<'portfolio-config'>, 'id'>,
): Promise<Result<CoreStorageRecord<'portfolio-config'>, StorageBoundaryError | InvariantViolationError>> {
	return createRecord('portfolio-config', storage, portfolioConfigRecord(record))
}

async function updatePortfolioConfigRecord(
	storage: CoreStorage,
	record: Omit<CoreStorageRecord<'portfolio-config'>, 'id'>,
): Promise<Result<CoreStorageRecord<'portfolio-config'>, StorageOperationFailedError | InvariantViolationError>> {
	try {
		const updated = await storage.on(portfolioConfigSchema).one().id(portfolioConfigStorageId).update(record)
		return { ok: true, value: updated ?? portfolioConfigRecord(record) }
	} catch (error) {
		return writeStorageError('portfolio-config', { type: 'update', resource: 'portfolio-config', id: portfolioConfigStorageId }, error)
	}
}

function portfolioConfigRecord(record: Omit<CoreStorageRecord<'portfolio-config'>, 'id'>): CoreStorageRecord<'portfolio-config'> {
	return { id: portfolioConfigStorageId, ...record }
}

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
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: localStamp(),
			}
			options.tx.repositories.records.set(matching.id, matching)
			options.tx.repositories.records.set('repository-2', {
				id: 'repository-2',
				projectId: 'project-2',
				config: { provider: 'github', owner: 'Octo', name: 'Other', secretId: 'secret-1' },
				created: localStamp(),
			})

			const result = await listRecords('repository', options.storage, {
				where: (filter, fields) => filter.eq(fields.projectId, 'project-1'),
			})

			expect(result).toEqual({ ok: true, value: [matching] })
		})

		it('applies ordering and limits to storage adapter reads', async () => {
			const options = createTestCoreServices()
			const first = agentRunEvent('agent-run-event-1', 1)
			const second = agentRunEvent('agent-run-event-2', 2)
			const third = agentRunEvent('agent-run-event-3', 3)
			options.tx.agentRunEvents.records.set(third.id, third)
			options.tx.agentRunEvents.records.set(first.id, first)
			options.tx.agentRunEvents.records.set(second.id, second)

			const result = await listRecords('agent-run-event', options.storage, {
				where: (filter, fields) => filter.eq(fields.agentRunId, 'agent-run-1'),
				orderBy: [{ field: 'sequence', direction: 'asc' }],
				limit: 2,
			})

			expect(result).toEqual({ ok: true, value: [first, second] })
		})
	})

	function agentRunEvent(id: string, sequence: number) {
		return {
			id,
			agentRunId: 'agent-run-1',
			sequence,
			occurred: { at: '2026-06-10T12:00:00.000Z' },
			body: {
				type: 'input-message' as const,
				source: { type: 'runtime' as const },
				content: [{ type: 'text' as const, text: `event ${sequence}` }],
			},
		}
	}
}
