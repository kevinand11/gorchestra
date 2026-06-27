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
import type { CoreServices, CoreStorage } from '../services'
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

export type StorageBoundaryError = StorageOperationFailedError | InvalidCoreServiceOutputError

export async function withTransaction<TValue, TError>(
	options: Pick<CoreServices, 'storage'>,
	run: (storage: CoreStorage) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	try {
		return await options.storage.session(() => run(options.storage))
	} catch {
		return { ok: false, error: storageFailure({ type: 'transaction' }) }
	}
}

export async function withTwoPhaseTransaction<TClaim, TOutside, TValue, TError>(
	options: Pick<CoreServices, 'storage'>,
	phases: {
		read: (storage: CoreStorage) => Promise<Result<TClaim, TError>>
		run: (claim: TClaim) => Promise<Result<TOutside, TError>>
		write: (storage: CoreStorage, claim: TClaim, outside: TOutside) => Promise<Result<TValue, TError>>
	},
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	const claim = await withTransaction(options, phases.read)
	if (!claim.ok) return claim

	const outside = await phases.run(claim.value)
	if (!outside.ok) return outside

	return withTransaction(options, (storage) => phases.write(storage, claim.value, outside.value))
}

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

export interface ListRecordsOptions<Resource extends CoreIdResource> {
	where?: ListRecordsWhere<Resource>
}

export async function listRecords<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	options: ListRecordsOptions<Resource> = {},
): Promise<Result<Array<CoreIdStorageRecord<Resource>>, StorageBoundaryError>> {
	try {
		const schema = coreIdResourceSchemas[resource]
		const records = await (options.where === undefined
			? storage.on(schema).all().find()
			: storage
					.on(schema)
					.all()
					.where((filter) => options.where?.(filter, schema.fields as SchemaFields<CoreIdResourceSchema<Resource>>) ?? filter)
					.find())
		return { ok: true, value: records as unknown as Array<CoreIdStorageRecord<Resource>> }
	} catch (error) {
		return readStorageError(resource, { type: 'list', resource }, error)
	}
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
	})
}
