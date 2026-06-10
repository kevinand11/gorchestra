import { v, type Pipe, type PipeOutput } from 'valleyed'

import { importSnapshotBoundaryPipe, operationContextPipe, type ImportSnapshotInput, type OperationContext } from './boundary-pipes'
import {
	commandInputPipes,
	type AcceptPlanOutputResult,
	type AcceptRevisionOutputResult,
	type AbandonDeliveryResult,
	type CoreCommands,
	type OpenRevisionGateResult,
	type QueueDeliveryResult,
	type RetryDeliveryPreflightResult,
	type RunDeliveryWorkResult,
	type ShipDeliveryResult,
} from './commands'
import type {
	AlreadyArchivedError,
	ArchivedSecretReferenceError,
	CommandStubError,
	CorePreflightError,
	CoreResource,
	DuplicateSecretBindingError,
	ImportSnapshotError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	NotImplementedError,
	OpenCoreError,
	ResourceNotFoundError,
	StorageOperationFailedError,
	WorkStateQueryError,
	CoreStorageOperation,
} from './errors'
import type {
	ArchivePeriod,
	AuditStamp,
	Delivery,
	DeliveryWorkState,
	Model,
	ModelProvider,
	PortfolioSnapshotManifest,
	Secret,
	SecretBinding,
	SecretBindingId,
	SecretBindingScope,
	SecretId,
	SliceWorkState,
	ValidationEvidence,
} from './model'
import { queryArgumentPipes, type CoreQueries } from './queries'
import type { Result } from './result'
import {
	coreClockOutputPipe,
	coreIdOutputPipe,
	coreServicePreflightOutputPipe,
	openCoreOptionsPipe,
	type CorePreflightCheck,
	type CorePreflightReport,
	type CoreServicePreflightOutput,
	type CoreStorageTransaction,
	type OpenCoreOptions,
	type RepositoryTable,
} from './services'
import { createStorageBackedCommands } from './storage-backed-commands'
import { validateCoreInput, validateCoreServiceOutput } from './validation'

export interface GorchestraCore {
	preflight(): Promise<Result<CorePreflightReport, CorePreflightError>>
	commands: CoreCommands
	queries: CoreQueries
}

export interface ImportSnapshotResult {
	manifest: PortfolioSnapshotManifest
}

export function openCore(options: OpenCoreOptions): Result<GorchestraCore, OpenCoreError> {
	const validation = validateCoreInput(openCoreOptionsPipe, options, 'construction', 'openCore')

	if (!validation.ok) {
		return validation
	}

	const coreServices = validation.value

	return {
		ok: true,
		value: {
			preflight: () => preflightCore(coreServices),
			commands: createCoreCommands(coreServices),
			queries: createCoreQueries(),
		},
	}
}

/**
 * Import creates a new Portfolio storage boundary, so it is not a command on an
 * already-open GorchestraCore instance.
 */
export async function importSnapshot(
	input: ImportSnapshotInput,
	context: OperationContext,
): Promise<Result<ImportSnapshotResult, ImportSnapshotError>> {
	const validation = validateCoreInput(importSnapshotBoundaryPipe, { input, context }, 'snapshot-import', 'importSnapshot')

	if (!validation.ok) {
		return validation
	}

	return Promise.resolve({ ok: false, error: { type: 'not-implemented', operation: 'importSnapshot' } })
}

async function preflightCore(options: OpenCoreOptions): Promise<Result<CorePreflightReport, CorePreflightError>> {
	const storageCheck = await preflightCoreService('storage', () => options.storage.preflight())
	if (!storageCheck.ok) return storageCheck

	const secretsCheck = await preflightCoreService('secrets', () => options.secrets.preflight())
	if (!secretsCheck.ok) return secretsCheck

	const sandboxCheck = await preflightCoreService('sandbox', () => options.sandbox.preflight())
	if (!sandboxCheck.ok) return sandboxCheck

	const clockCheck = preflightRuntimeService('clock', 'now', () => options.clock.now(), coreClockOutputPipe)
	if (!clockCheck.ok) return clockCheck

	const idGeneratorCheck = preflightRuntimeService(
		'idGenerator',
		'next',
		() => options.idGenerator.next('core-preflight'),
		coreIdOutputPipe,
	)
	if (!idGeneratorCheck.ok) return idGeneratorCheck

	const checks = {
		storage: storageCheck.value,
		secrets: secretsCheck.value,
		sandbox: sandboxCheck.value,
		clock: clockCheck.value,
		idGenerator: idGeneratorCheck.value,
	}

	const passed = [checks.storage, checks.secrets, checks.sandbox, checks.clock, checks.idGenerator].every((check) => check.ok)

	return { ok: true, value: { passed, checks } }
}

async function preflightCoreService(
	service: 'storage' | 'secrets' | 'sandbox',
	probe: () => Promise<CoreServicePreflightOutput>,
): Promise<Result<CorePreflightCheck, CorePreflightError>> {
	try {
		const output = await probe()
		const validation = validateCoreServiceOutput(coreServicePreflightOutputPipe, output, service, 'preflight')

		if (!validation.ok) {
			return validation
		}

		return { ok: true, value: preflightCheckFromCoreServiceOutput(validation.value) }
	} catch {
		return { ok: true, value: failedProbeCheck() }
	}
}

function preflightRuntimeService<TPipe extends Pipe<unknown, unknown>>(
	service: 'clock' | 'idGenerator',
	operation: string,
	probe: () => unknown,
	outputPipe: TPipe,
): Result<CorePreflightCheck, CorePreflightError> {
	try {
		const output = probe()
		const validation = validateCoreServiceOutput(outputPipe, output, service, operation)

		if (!validation.ok) {
			return validation
		}

		return { ok: true, value: { ok: true } }
	} catch {
		return { ok: true, value: failedProbeCheck() }
	}
}

function preflightCheckFromCoreServiceOutput(output: CoreServicePreflightOutput): CorePreflightCheck {
	return output.ok ? { ok: true } : { ok: false, reason: 'not-ready', message: output.message }
}

function failedProbeCheck(): CorePreflightCheck {
	return { ok: false, reason: 'probe-failed', message: null }
}

function createCoreCommands(options: OpenCoreOptions): CoreCommands {
	return {
		...createStorageBackedCommands(options),
		createModelProvider(input, context) {
			return commandStub<ModelProvider>('createModelProvider', input, context)
		},
		updateModelProvider(input, context) {
			return commandStub<ModelProvider>('updateModelProvider', input, context)
		},
		archiveModelProvider(input, context) {
			return commandStub<ModelProvider>('archiveModelProvider', input, context)
		},
		unarchiveModelProvider(input, context) {
			return commandStub<ModelProvider>('unarchiveModelProvider', input, context)
		},
		createModel(input, context) {
			return commandStub<Model>('createModel', input, context)
		},
		updateModel(input, context) {
			return commandStub<Model>('updateModel', input, context)
		},
		archiveModel(input, context) {
			return commandStub<Model>('archiveModel', input, context)
		},
		unarchiveModel(input, context) {
			return commandStub<Model>('unarchiveModel', input, context)
		},
		preflightModel(input, context) {
			return commandStub<ValidationEvidence>('preflightModel', input, context)
		},
		preflightRepository(input, context) {
			return commandStub<ValidationEvidence>('preflightRepository', input, context)
		},
		acceptPlanOutput(input, context) {
			return commandStub<AcceptPlanOutputResult>('acceptPlanOutput', input, context)
		},
		rejectPlanOutput(input, context) {
			return commandStub<void>('rejectPlanOutput', input, context)
		},
		configureDelivery(input, context) {
			return commandStub<Delivery>('configureDelivery', input, context)
		},
		queueDelivery(input, context) {
			return commandStub<QueueDeliveryResult>('queueDelivery', input, context)
		},
		runDeliveryWork(input, context) {
			return commandStub<RunDeliveryWorkResult>('runDeliveryWork', input, context)
		},
		retryDeliveryPreflight(input, context) {
			return commandStub<RetryDeliveryPreflightResult>('retryDeliveryPreflight', input, context)
		},
		openRevisionGate(input, context) {
			return commandStub<OpenRevisionGateResult>('openRevisionGate', input, context)
		},
		acceptRevisionOutput(input, context) {
			return commandStub<AcceptRevisionOutputResult>('acceptRevisionOutput', input, context)
		},
		closeRevisionGate(input, context) {
			return commandStub<void>('closeRevisionGate', input, context)
		},
		shipDelivery(input, context) {
			return commandStub<ShipDeliveryResult>('shipDelivery', input, context)
		},
		abandonDelivery(input, context) {
			return commandStub<AbandonDeliveryResult>('abandonDelivery', input, context)
		},
		createSecret(input, context) {
			return createSecretCommand(options, input, context)
		},
		replaceSecret(input, context) {
			return replaceSecretCommand(options, input, context)
		},
		archiveSecret(input, context) {
			return archiveSecretCommand(options, input, context)
		},
		unarchiveSecret(input, context) {
			return unarchiveSecretCommand(options, input, context)
		},
		bindSecret(input, context) {
			return bindSecretCommand(options, input, context)
		},
		archiveSecretBinding(input, context) {
			return archiveSecretBindingCommand(options, input, context)
		},
		unarchiveSecretBinding(input, context) {
			return unarchiveSecretBindingCommand(options, input, context)
		},
		exportSnapshot(input, context) {
			return commandStub<PortfolioSnapshotManifest>('exportSnapshot', input, context)
		},
	}
}

async function createSecretCommand(options: OpenCoreOptions, input: unknown, context: unknown): ReturnType<CoreCommands['createSecret']> {
	const validation = validateCommand('createSecret', commandInputPipes.createSecret, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'createSecret')
	if (!stamp.ok) return stamp

	const id = nextCoreId<SecretId>(options, 'secret')
	if (!id.ok) return id

	const secret: Secret = {
		id: id.value,
		name: validation.value.input.name,
		valueRef: validation.value.input.valueRef,
		created: stamp.value,
		replaced: null,
		archivePeriods: [],
	}

	return withStorageTransaction<Secret, StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret', id: id.value },
		async (tx) => {
			const stored = await putRecord(tx.secrets, 'secret', id.value, secret)
			if (!stored.ok) return stored

			return { ok: true, value: secret }
		},
	)
}

async function replaceSecretCommand(options: OpenCoreOptions, input: unknown, context: unknown): ReturnType<CoreCommands['replaceSecret']> {
	const validation = validateCommand('replaceSecret', commandInputPipes.replaceSecret, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'replaceSecret')
	if (!stamp.ok) return stamp

	return withStorageTransaction<Secret, ResourceNotFoundError | StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret', id: validation.value.input.secretId },
		async (tx) => {
			const existing = await getRecord(tx.secrets, 'secret', validation.value.input.secretId)
			if (!existing.ok) return existing
			if (existing.value === null) return notFound('secret', validation.value.input.secretId)

			const secret: Secret = { ...existing.value, valueRef: validation.value.input.valueRef, replaced: stamp.value }
			const stored = await putRecord(tx.secrets, 'secret', secret.id, secret)
			if (!stored.ok) return stored

			return { ok: true, value: secret }
		},
	)
}

async function archiveSecretCommand(options: OpenCoreOptions, input: unknown, context: unknown): ReturnType<CoreCommands['archiveSecret']> {
	const validation = validateCommand('archiveSecret', commandInputPipes.archiveSecret, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'archiveSecret')
	if (!stamp.ok) return stamp

	return withStorageTransaction<Secret, ResourceNotFoundError | AlreadyArchivedError | StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret', id: validation.value.input.secretId },
		async (tx) => {
			const existing = await getRecord(tx.secrets, 'secret', validation.value.input.secretId)
			if (!existing.ok) return existing
			if (existing.value === null) return notFound('secret', validation.value.input.secretId)

			const archived = archiveRecord(existing.value, stamp.value, 'secret', validation.value.input.secretId)
			if (!archived.ok) return archived

			const stored = await putRecord(tx.secrets, 'secret', archived.value.id, archived.value)
			if (!stored.ok) return stored

			return archived
		},
	)
}

async function unarchiveSecretCommand(
	options: OpenCoreOptions,
	input: unknown,
	context: unknown,
): ReturnType<CoreCommands['unarchiveSecret']> {
	const validation = validateCommand('unarchiveSecret', commandInputPipes.unarchiveSecret, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'unarchiveSecret')
	if (!stamp.ok) return stamp

	return withStorageTransaction<Secret, ResourceNotFoundError | NotArchivedError | StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret', id: validation.value.input.secretId },
		async (tx) => {
			const existing = await getRecord(tx.secrets, 'secret', validation.value.input.secretId)
			if (!existing.ok) return existing
			if (existing.value === null) return notFound('secret', validation.value.input.secretId)

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'secret', validation.value.input.secretId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord(tx.secrets, 'secret', unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		},
	)
}

async function bindSecretCommand(options: OpenCoreOptions, input: unknown, context: unknown): ReturnType<CoreCommands['bindSecret']> {
	const validation = validateCommand('bindSecret', commandInputPipes.bindSecret, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'bindSecret')
	if (!stamp.ok) return stamp

	const id = nextCoreId<SecretBindingId>(options, 'secret-binding')
	if (!id.ok) return id

	const scope = validation.value.input.scope as SecretBindingScope

	return withStorageTransaction<
		SecretBinding,
		ResourceNotFoundError | ArchivedSecretReferenceError | DuplicateSecretBindingError | StorageOperationFailedError
	>(options, { type: 'put', resource: 'secret-binding', id: id.value }, async (tx) => {
		const secret = await getRecord(tx.secrets, 'secret', validation.value.input.secretId)
		if (!secret.ok) return secret
		if (secret.value === null) return notFound('secret', validation.value.input.secretId)
		if (isArchived(secret.value)) return archivedSecretReference(validation.value.input.secretId)

		const bindings = await listRecords(tx.secretBindings, 'secret-binding')
		if (!bindings.ok) return bindings

		const duplicate = bindings.value.find(
			(binding) => binding.envName === validation.value.input.envName && scopesEqual(binding.scope, scope),
		)
		if (duplicate !== undefined) {
			return duplicateSecretBinding(duplicate.id, scope, validation.value.input.envName)
		}

		const binding: SecretBinding = {
			id: id.value,
			secretId: validation.value.input.secretId,
			scope,
			envName: validation.value.input.envName,
			created: stamp.value,
			archivePeriods: [],
		}
		const stored = await putRecord(tx.secretBindings, 'secret-binding', binding.id, binding)
		if (!stored.ok) return stored

		return { ok: true, value: binding }
	})
}

async function archiveSecretBindingCommand(
	options: OpenCoreOptions,
	input: unknown,
	context: unknown,
): ReturnType<CoreCommands['archiveSecretBinding']> {
	const validation = validateCommand('archiveSecretBinding', commandInputPipes.archiveSecretBinding, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'archiveSecretBinding')
	if (!stamp.ok) return stamp

	return withStorageTransaction<SecretBinding, ResourceNotFoundError | AlreadyArchivedError | StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret-binding', id: validation.value.input.secretBindingId },
		async (tx) => {
			const existing = await getRecord(tx.secretBindings, 'secret-binding', validation.value.input.secretBindingId)
			if (!existing.ok) return existing
			if (existing.value === null) return notFound('secret-binding', validation.value.input.secretBindingId)

			const archived = archiveRecord(existing.value, stamp.value, 'secret-binding', validation.value.input.secretBindingId)
			if (!archived.ok) return archived

			const stored = await putRecord(tx.secretBindings, 'secret-binding', archived.value.id, archived.value)
			if (!stored.ok) return stored

			return archived
		},
	)
}

async function unarchiveSecretBindingCommand(
	options: OpenCoreOptions,
	input: unknown,
	context: unknown,
): ReturnType<CoreCommands['unarchiveSecretBinding']> {
	const validation = validateCommand('unarchiveSecretBinding', commandInputPipes.unarchiveSecretBinding, input, context)

	if (!validation.ok) {
		return validation
	}

	const stamp = localAuditStamp(options, validation.value.context, 'unarchiveSecretBinding')
	if (!stamp.ok) return stamp

	return withStorageTransaction<SecretBinding, ResourceNotFoundError | NotArchivedError | StorageOperationFailedError>(
		options,
		{ type: 'put', resource: 'secret-binding', id: validation.value.input.secretBindingId },
		async (tx) => {
			const existing = await getRecord(tx.secretBindings, 'secret-binding', validation.value.input.secretBindingId)
			if (!existing.ok) return existing
			if (existing.value === null) return notFound('secret-binding', validation.value.input.secretBindingId)

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'secret-binding', validation.value.input.secretBindingId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord(tx.secretBindings, 'secret-binding', unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		},
	)
}

function createCoreQueries(): CoreQueries {
	return {
		getDeliveryWorkState: (...args: unknown[]) => queryStub<DeliveryWorkState>('getDeliveryWorkState', args),
		getSliceWorkState: (...args: unknown[]) => queryStub<SliceWorkState>('getSliceWorkState', args),
	}
}

type ArchivableRecord = { archivePeriods: ArchivePeriod[] }
type CoreStorageResource = CoreResource

function validateCommand<TPipe extends Pipe<unknown, unknown>>(
	operation: keyof CoreCommands,
	pipe: TPipe,
	input: unknown,
	context: unknown,
): Result<{ input: PipeOutput<TPipe>; context: OperationContext }, InvalidInputError> {
	return validateCoreInput(v.object({ input: pipe, context: operationContextPipe }), { input, context }, 'command', operation)
}

function localAuditStamp(
	options: OpenCoreOptions,
	context: OperationContext,
	operation: string,
): Result<AuditStamp, InvalidCoreServiceOutputError> {
	const validation = validateCoreServiceOutput(coreClockOutputPipe, options.clock.now(), 'clock', operation)

	if (!validation.ok) {
		return validation
	}

	return {
		ok: true,
		value: {
			origin: 'local',
			at: validation.value.toISOString(),
			actor: context.actor,
			correlationId: context.correlationId,
		},
	}
}

function nextCoreId<Id extends string>(
	options: OpenCoreOptions,
	brand: 'secret' | 'secret-binding',
): Result<Id, InvalidCoreServiceOutputError> {
	const validation = validateCoreServiceOutput(coreIdOutputPipe, options.idGenerator.next(brand), 'idGenerator', `next:${brand}`)

	if (!validation.ok) {
		return validation
	}

	return { ok: true, value: validation.value as Id }
}

async function withStorageTransaction<T, E>(
	options: OpenCoreOptions,
	fallbackOperation: CoreStorageOperation,
	fn: (tx: CoreStorageTransaction) => Promise<Result<T, E>>,
): Promise<Result<T, E | StorageOperationFailedError>> {
	try {
		return await options.storage.transaction(fn)
	} catch {
		return storageOperationFailed(fallbackOperation)
	}
}

async function getRecord<T, Id extends string>(
	table: RepositoryTable<T, Id>,
	resource: CoreStorageResource,
	id: Id,
): Promise<Result<T | null, StorageOperationFailedError>> {
	try {
		return { ok: true, value: await table.get(id) }
	} catch {
		return storageOperationFailed({ type: 'get', resource, id })
	}
}

async function listRecords<T, Id>(
	table: RepositoryTable<T, Id>,
	resource: CoreStorageResource,
): Promise<Result<T[], StorageOperationFailedError>> {
	try {
		return { ok: true, value: await table.list() }
	} catch {
		return storageOperationFailed({ type: 'list', resource })
	}
}

async function putRecord<T, Id extends string>(
	table: RepositoryTable<T, Id>,
	resource: CoreStorageResource,
	id: Id,
	record: T,
): Promise<Result<void, StorageOperationFailedError>> {
	try {
		await table.put(record)
		return { ok: true, value: undefined }
	} catch {
		return storageOperationFailed({ type: 'put', resource, id })
	}
}

function isArchived(record: ArchivableRecord): boolean {
	const latestPeriod = record.archivePeriods[record.archivePeriods.length - 1]

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

function archiveRecord<T extends ArchivableRecord>(
	record: T,
	stamp: AuditStamp,
	resource: 'secret' | 'secret-binding',
	id: string,
): Result<T, AlreadyArchivedError> {
	if (isArchived(record)) {
		return { ok: false, error: { type: 'already-archived', resource, id } }
	}

	return {
		ok: true,
		value: { ...record, archivePeriods: [...record.archivePeriods, { archived: stamp, unarchived: null }] },
	}
}

function unarchiveRecord<T extends ArchivableRecord>(
	record: T,
	stamp: AuditStamp,
	resource: 'secret' | 'secret-binding',
	id: string,
): Result<T, NotArchivedError> {
	const latestPeriodIndex = record.archivePeriods.length - 1
	const latestPeriod = record.archivePeriods[latestPeriodIndex]

	if (latestPeriod === undefined || latestPeriod.unarchived !== null) {
		return { ok: false, error: { type: 'not-archived', resource, id } }
	}

	const archivePeriods = record.archivePeriods.map((period, index) =>
		index === latestPeriodIndex ? { ...period, unarchived: stamp } : period,
	)

	return { ok: true, value: { ...record, archivePeriods } }
}

function scopesEqual(left: SecretBindingScope, right: SecretBindingScope): boolean {
	if (left.type !== right.type) {
		return false
	}

	if (left.type === 'portfolio') {
		return true
	}

	if (left.type === 'project' && right.type === 'project') {
		return left.projectId === right.projectId
	}

	return left.type === 'delivery' && right.type === 'delivery' && left.deliveryId === right.deliveryId
}

function notFound(resource: CoreStorageResource, id: string): Result<never, ResourceNotFoundError> {
	return { ok: false, error: { type: 'not-found', resource, id } }
}

function duplicateSecretBinding(
	existingSecretBindingId: SecretBindingId,
	scope: SecretBindingScope,
	envName: string,
): Result<never, DuplicateSecretBindingError> {
	return { ok: false, error: { type: 'duplicate-secret-binding', existingSecretBindingId, scope, envName } }
}

function archivedSecretReference(secretId: SecretId): Result<never, ArchivedSecretReferenceError> {
	return { ok: false, error: { type: 'archived-secret-reference', secretId } }
}

function storageOperationFailed(operation: CoreStorageOperation): Result<never, StorageOperationFailedError> {
	return { ok: false, error: { type: 'storage-operation-failed', operation } }
}

function commandStub<T>(operation: keyof CoreCommands, input: unknown, context: unknown): Promise<Result<T, CommandStubError>> {
	const validation = validateCoreInput(
		v.object({ input: commandInputPipes[operation], context: operationContextPipe }),
		{ input, context },
		'command',
		operation,
	)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function queryStub<T>(operation: keyof CoreQueries, args: unknown[]): Promise<Result<T, WorkStateQueryError>> {
	const validation = validateCoreInput(v.object({ args: queryArgumentPipes[operation] }), { args }, 'query', operation)

	if (!validation.ok) {
		return Promise.resolve(validation)
	}

	return Promise.resolve(notImplemented<T>(operation))
}

function notImplemented<T>(operation: string): Result<T, NotImplementedError> {
	return { ok: false, error: { type: 'not-implemented', operation } }
}
