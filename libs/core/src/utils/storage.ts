import { v, type Pipe, type PipeOutput } from 'valleyed'

import {
	idPipe,
	isoDateTimePipe,
	type AuditStamp,
	type Id,
	type IsoDateTime,
	type OperationContext,
	type RuntimeRecord,
} from '../domain/commons'
import type {
	CoreIdResource,
	CoreSingletonResource,
	CoreStorageOperation,
	InvalidCoreServiceOutputError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { type CoreServices, type CoreStorageTransaction, type RepositoryTable, type SingletonRepository } from '../services'
import { validateCoreServiceOutput } from '../validation'
import type { Result } from './types'

export type StorageBoundaryError = StorageOperationFailedError | InvalidCoreServiceOutputError

type StorageResult<T> = Result<T, StorageBoundaryError>

export async function withTransaction<TValue, TError>(
	options: CoreServices,
	run: (tx: CoreStorageTransaction) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	try {
		return await options.storage.transaction(run)
	} catch {
		return { ok: false, error: storageFailure({ type: 'transaction' }) }
	}
}

export async function withTwoPhaseTransaction<TClaim, TOutside, TValue, TError>(
	options: CoreServices,
	phases: {
		read: (tx: CoreStorageTransaction) => Promise<Result<TClaim, TError>>
		run: (claim: TClaim) => Promise<Result<TOutside, TError>>
		write: (tx: CoreStorageTransaction, claim: TClaim, outside: TOutside) => Promise<Result<TValue, TError>>
	},
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	const claim = await withTransaction(options, phases.read)
	if (!claim.ok) return claim

	const outside = await phases.run(claim.value)
	if (!outside.ok) return outside

	return withTransaction(options, (tx) => phases.write(tx, claim.value, outside.value))
}

export async function getRequiredSingleton<TRecord>(
	resource: CoreSingletonResource,
	repository: SingletonRepository<TRecord>,
	recordPipe: Pipe<unknown, TRecord>,
): Promise<Result<TRecord, StorageBoundaryError | SingletonNotFoundError>> {
	try {
		const record = await repository.get()
		if (record === null) return singletonNotFound(resource)

		return validateStorageOutput(recordPipe, record, `get-singleton:${resource}`)
	} catch {
		return { ok: false, error: storageFailure({ type: 'get-singleton', resource }) }
	}
}

export async function putSingleton<TRecord>(
	resource: CoreSingletonResource,
	repository: SingletonRepository<TRecord>,
	record: TRecord,
): Promise<StorageResult<void>> {
	try {
		await repository.put(record)
		return { ok: true, value: undefined }
	} catch {
		return { ok: false, error: storageFailure({ type: 'put-singleton', resource }) }
	}
}

export async function getRecord<TRecord>(
	resource: CoreIdResource,
	repository: RepositoryTable<TRecord>,
	id: Id,
	recordPipe: Pipe<unknown, TRecord>,
): Promise<StorageResult<TRecord | null>> {
	try {
		const record = await repository.get(id)
		return record === null ? { ok: true, value: null } : validateStoredRecord(resource, id, recordPipe, record)
	} catch {
		return { ok: false, error: storageFailure({ type: 'get', resource, id }) }
	}
}

function validateStoredRecord<TRecord>(
	resource: CoreIdResource,
	id: Id,
	recordPipe: Pipe<unknown, TRecord>,
	record: unknown,
): StorageResult<TRecord> {
	const validation = validateStorageOutput(recordPipe, record, `get:${resource}`)
	if (!validation.ok) return validation

	const idValidation = validateStorageOutput(v.object({ id: v.eq(id) }), validation.value, `get:${resource}`)
	return idValidation.ok ? { ok: true, value: validation.value } : idValidation
}

export async function getRequired<TRecord>(
	resource: CoreIdResource,
	repository: RepositoryTable<TRecord>,
	id: Id,
	recordPipe: Pipe<unknown, TRecord>,
): Promise<Result<TRecord, StorageBoundaryError | ResourceNotFoundError>> {
	const recordResult = await getRecord(resource, repository, id, recordPipe)
	if (!recordResult.ok) return recordResult
	if (recordResult.value === null) return notFound(resource, id)

	return { ok: true, value: recordResult.value }
}

export async function putRecord<TRecord extends { id: Id }>(
	resource: CoreIdResource,
	repository: RepositoryTable<TRecord>,
	id: Id,
	record: TRecord,
): Promise<StorageResult<void>> {
	try {
		await repository.put(record)
		return { ok: true, value: undefined }
	} catch {
		return { ok: false, error: storageFailure({ type: 'put', resource, id }) }
	}
}

export async function listRecords<TRecord>(
	resource: CoreIdResource,
	repository: RepositoryTable<TRecord>,
	recordPipe: Pipe<unknown, TRecord>,
): Promise<StorageResult<TRecord[]>> {
	try {
		const records = await repository.list()
		const validation = validateStorageOutput(v.array(recordPipe), records, `list:${resource}`)
		if (!validation.ok) return validation

		return { ok: true, value: validation.value }
	} catch {
		return { ok: false, error: storageFailure({ type: 'list', resource }) }
	}
}

export function auditStamp(options: CoreServices, context: OperationContext): Result<AuditStamp, InvalidCoreServiceOutputError> {
	const nowResult = nowIso(options)
	if (!nowResult.ok) return nowResult

	return {
		ok: true,
		value: {
			origin: 'local',
			at: nowResult.value,
			actor: context.actor,
			correlationId: context.correlationId,
		},
	}
}

export function runtimeRecord(options: CoreServices): Result<RuntimeRecord, InvalidCoreServiceOutputError> {
	const nowResult = nowIso(options)
	if (!nowResult.ok) return nowResult

	return { ok: true, value: { at: nowResult.value } }
}

export function nextId(options: CoreServices, brand: string): Result<Id, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = options.idGenerator.next(brand)
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(idPipe, output, 'idGenerator', 'next')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value }
}

export function notFound(resource: CoreIdResource, id: Id): Result<never, ResourceNotFoundError> {
	return { ok: false, error: { type: 'not-found', resource, id } }
}

function singletonNotFound(resource: CoreSingletonResource): Result<never, SingletonNotFoundError> {
	return { ok: false, error: { type: 'not-found-singleton', resource } }
}

function nowIso(options: CoreServices): Result<IsoDateTime, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = options.clock.now()
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(isoDateTimePipe, output, 'clock', 'now')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value }
}

function validateStorageOutput<TPipe extends Pipe<unknown, unknown>>(
	pipe: TPipe,
	value: unknown,
	operation: string,
): Result<PipeOutput<TPipe>, InvalidCoreServiceOutputError> {
	return validateCoreServiceOutput(pipe, value, 'storage', operation)
}

function storageFailure(operation: CoreStorageOperation): StorageOperationFailedError {
	return { type: 'storage-operation-failed', operation }
}
