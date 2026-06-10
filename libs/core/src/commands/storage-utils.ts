import { v, type Pipe, type PipeOutput } from 'valleyed'

import type { ConfigCommandReferenceError, ConfigCommandStorageError, RepositoryCommandReferenceError } from './errors'
import type { ArchivePeriod, AuditStamp, Id, IsoDateTime, OperationContext } from '../domain/commons'
import type { PlanConfig, PlanConfigRecord, PortfolioConfig, ProjectConfig, ProjectConfigRecord } from '../domain/config'
import { modelPipe, type Model } from '../domain/model'
import { modelProviderPipe, type ModelProvider, type ModelProviderAuth, type ModelProviderHeader } from '../domain/model-provider'
import { projectPipe, type Project } from '../domain/project'
import { repositoryPipe, type RepositoryConfig } from '../domain/repository'
import { secretPipe, type Secret, type SecretBindingScope } from '../domain/secret'
import type {
	AlreadyArchivedError,
	ArchivableCoreResource,
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	ArchivedSecretReferenceError,
	CoreResource,
	CoreStorageOperation,
	DuplicateRepositoryTargetError,
	DuplicateSecretBindingError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import {
	coreClockOutputPipe,
	coreIdOutputPipe,
	type CoreStorageTransaction,
	type OpenCoreOptions,
	type RepositoryTable,
	type SingletonRepository,
} from '../services'
import type { Result } from '../types'
import { validateCoreServiceOutput } from '../validation'

export type CommandBoundary<TInput> = {
	input: TInput
	context: OperationContext
}

type StorageBackedCommandError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| ArchivedModelProviderReferenceError
	| ArchivedSecretReferenceError
	| SecretNotActiveError
	| DuplicateRepositoryTargetError
	| ProjectSourceTypeMismatchError
	| AlreadyArchivedError
	| NotArchivedError
	| DuplicateSecretBindingError
	| ConfigCommandReferenceError
	| ConfigCommandStorageError
	| RepositoryCommandReferenceError

type StorageBoundaryError = StorageOperationFailedError | InvalidCoreServiceOutputError

type StorageResult<T> = Result<T, StorageBoundaryError>

type ArchivableRecord = { archivePeriods: ArchivePeriod[] }

export async function withTransaction<TValue, TError extends StorageBackedCommandError>(
	options: OpenCoreOptions,
	run: (tx: CoreStorageTransaction) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	try {
		return await options.storage.transaction(run)
	} catch {
		return { ok: false, error: storageFailure({ type: 'transaction' }) }
	}
}

export async function putSingleton<TRecord>(
	resource: 'portfolio-config',
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

export // fallow-ignore-next-line complexity
async function getRecord<TRecord>(
	resource: CoreResource,
	repository: RepositoryTable<TRecord>,
	id: Id,
	recordPipe: Pipe<unknown, TRecord>,
): Promise<StorageResult<TRecord | null>> {
	try {
		const record = await repository.get(id)
		if (record === null) return { ok: true, value: null }

		const validation = validateStorageOutput(recordPipe, record, `get:${resource}`)
		if (!validation.ok) return validation

		const idValidation = validateStorageOutput(v.object({ id: v.eq(id) }), validation.value, `get:${resource}`)
		if (!idValidation.ok) return idValidation

		return { ok: true, value: validation.value }
	} catch {
		return { ok: false, error: storageFailure({ type: 'get', resource, id }) }
	}
}

export async function getRequired<TRecord>(
	resource: CoreResource,
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
	resource: CoreResource,
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
	resource: CoreResource,
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

// fallow-ignore-next-line complexity
export async function validateSelectableModels(
	tx: CoreStorageTransaction,
	modelIds: Id[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	for (const modelId of uniqueIds(modelIds)) {
		const modelResult = await getRequired('model', tx.models, modelId, modelPipe)
		if (!modelResult.ok) return modelResult

		const modelSelectability = validateActiveModel(modelResult.value)
		if (!modelSelectability.ok) return modelSelectability

		const providerResult = await getRequired('model-provider', tx.modelProviders, modelResult.value.providerId, modelProviderPipe)
		if (!providerResult.ok) return providerResult

		const providerSelectability = validateActiveModelProvider(providerResult.value)
		if (!providerSelectability.ok) return providerSelectability
	}

	return { ok: true, value: undefined }
}

export async function validateSourceControlProject(
	tx: CoreStorageTransaction,
	projectId: Id,
): Promise<Result<Project, StorageBoundaryError | ResourceNotFoundError | ProjectSourceTypeMismatchError>> {
	const projectResult = await getRequired('project', tx.projects, projectId, projectPipe)
	if (!projectResult.ok) return projectResult
	if (projectResult.value.source.type !== 'source-control') {
		return {
			ok: false,
			error: {
				type: 'project-source-type-mismatch',
				projectId,
				expected: 'source-control',
				actual: projectResult.value.source.type,
			},
		}
	}

	return projectResult
}

export async function validateActiveSecret(
	tx: CoreStorageTransaction,
	secretId: Id,
): Promise<Result<Secret, StorageBoundaryError | ResourceNotFoundError | SecretNotActiveError>> {
	const secretResult = await getRequired('secret', tx.secrets, secretId, secretPipe)
	if (!secretResult.ok) return secretResult
	if (isArchived(secretResult.value.archivePeriods)) {
		return { ok: false, error: { type: 'secret-not-active', secretId } }
	}

	return secretResult
}

// fallow-ignore-next-line complexity
export async function validateActiveSecretReferences(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	for (const secretId of secretIds) {
		const secret = await getRecord('secret', tx.secrets, secretId, secretPipe)
		if (!secret.ok) return secret
		if (secret.value === null) return notFound('secret', secretId)
		if (isArchived(secret.value.archivePeriods)) return archivedSecretReference(secretId)
	}

	return { ok: true, value: undefined }
}

export async function validateUniqueRepositoryTarget(
	tx: CoreStorageTransaction,
	projectId: Id,
	config: RepositoryConfig,
	excludeRepositoryId: Id | null,
): Promise<Result<void, StorageBoundaryError | DuplicateRepositoryTargetError>> {
	const repositoriesResult = await listRecords('repository', tx.repositories, repositoryPipe)
	if (!repositoriesResult.ok) return repositoriesResult

	const target = repositoryTargetKey(config)
	const duplicate = repositoriesResult.value.find(
		(repository) =>
			repository.projectId === projectId &&
			repository.id !== excludeRepositoryId &&
			repositoryTargetKey(repository.config) === target,
	)

	if (duplicate !== undefined) {
		return {
			ok: false,
			error: {
				type: 'duplicate-repository-target',
				projectId,
				provider: config.provider,
				owner: config.owner,
				name: config.name,
			},
		}
	}

	return { ok: true, value: undefined }
}

export function auditStamp(options: OpenCoreOptions, context: OperationContext): Result<AuditStamp, InvalidCoreServiceOutputError> {
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

export function nextId(options: OpenCoreOptions, brand: string): Result<Id, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = options.idGenerator.next(brand)
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(coreIdOutputPipe, output, 'idGenerator', 'next')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value }
}

export function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	const latestPeriod = archivePeriods.at(-1)

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

export function archiveRecord<T extends ArchivableRecord>(
	record: T,
	stamp: AuditStamp,
	resource: ArchivableCoreResource,
	id: Id,
): Result<T, AlreadyArchivedError> {
	if (isArchived(record.archivePeriods)) {
		return { ok: false, error: { type: 'already-archived', resource, id } }
	}

	return {
		ok: true,
		value: { ...record, archivePeriods: [...record.archivePeriods, { archived: stamp, unarchived: null }] },
	}
}

export function unarchiveRecord<T extends ArchivableRecord>(
	record: T,
	stamp: AuditStamp,
	resource: ArchivableCoreResource,
	id: Id,
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

export function normalizePortfolioConfig(config: PortfolioConfig): PortfolioConfig {
	return {
		model: { ...config.model },
		work: config.work === null ? null : { ...config.work },
	}
}

export function normalizeProjectConfigRecordForCreate(config: ProjectConfig | null, configured: AuditStamp): ProjectConfigRecord | null {
	if (config === null) {
		return null
	}

	const normalized = normalizeProjectConfig(config)
	return normalized === null ? null : { configured, value: normalized }
}

export function normalizeProjectConfigRecord(config: ProjectConfig | null, configured: AuditStamp): ProjectConfigRecord | null {
	if (config === null) {
		return null
	}

	return { configured, value: normalizeProjectConfig(config) }
}

export function normalizeProjectConfig(config: ProjectConfig): ProjectConfig | null {
	const model = normalizeProjectModelConfig(config.model)
	const work = config.work === null ? null : { ...config.work }

	if (model === null && work === null) {
		return null
	}

	return { model, work }
}

export function normalizePlanConfigRecord(config: PlanConfig | null, configured: AuditStamp): PlanConfigRecord | null {
	if (config === null) {
		return null
	}

	const normalized = normalizePlanConfig(config)
	return normalized === null ? null : { configured, value: normalized }
}

export function normalizeRepositoryConfig(config: RepositoryConfig): RepositoryConfig {
	return { ...config }
}

export function modelIdsFromPortfolioConfig(config: PortfolioConfig): Id[] {
	return [
		config.model.defaultModelId,
		config.model.planningModelId,
		config.model.revisionPlanningModelId,
		config.model.executionModelId,
		config.model.revisionExecutionModelId,
	].filter((modelId): modelId is Id => modelId !== null)
}

// fallow-ignore-next-line complexity
export function modelIdsFromProjectConfigRecord(config: ProjectConfigRecord | null): Id[] {
	if (config?.value?.model === null || config?.value === null || config === null) {
		return []
	}

	return [
		config.value.model.planningModelId,
		config.value.model.revisionPlanningModelId,
		config.value.model.executionModelId,
		config.value.model.revisionExecutionModelId,
	].filter((modelId): modelId is Id => modelId !== null)
}

export function modelIdsFromPlanConfigRecord(config: PlanConfigRecord): Id[] {
	if (config.value === null || config.value.model === null || config.value.model.planningModelId === null) {
		return []
	}

	return [config.value.model.planningModelId]
}

export function secretReferencesFromModelProviderConfig(auth: ModelProviderAuth | null, headers: ModelProviderHeader[]): Id[] {
	const references: Id[] = []

	if (auth !== null) {
		references.push(auth.secretId)
	}

	for (const header of headers) {
		references.push(header.valueSecretId)
	}

	return references
}

// fallow-ignore-next-line complexity
export function scopesEqual(left: SecretBindingScope, right: SecretBindingScope): boolean {
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

export function notFound(resource: CoreResource, id: Id): Result<never, ResourceNotFoundError> {
	return { ok: false, error: { type: 'not-found', resource, id } }
}

export function duplicateSecretBinding(
	existingSecretBindingId: Id,
	scope: SecretBindingScope,
	envName: string,
): Result<never, DuplicateSecretBindingError> {
	return { ok: false, error: { type: 'duplicate-secret-binding', existingSecretBindingId, scope, envName } }
}

export function archivedSecretReference(secretId: Id): Result<never, ArchivedSecretReferenceError> {
	return { ok: false, error: { type: 'archived-secret-reference', secretId } }
}

export function archivedModelProviderReference(modelProviderId: Id): Result<never, ArchivedModelProviderReferenceError> {
	return { ok: false, error: { type: 'archived-model-provider-reference', modelProviderId } }
}

function nowIso(options: OpenCoreOptions): Result<IsoDateTime, InvalidCoreServiceOutputError> {
	let output: unknown
	try {
		output = options.clock.now()
	} catch {
		output = undefined
	}

	const validation = validateCoreServiceOutput(coreClockOutputPipe, output, 'clock', 'now')
	if (!validation.ok) return validation

	return { ok: true, value: validation.value.toISOString() }
}

// fallow-ignore-next-line complexity
function normalizeProjectModelConfig(model: ProjectConfig['model']): ProjectConfig['model'] {
	if (model === null) {
		return null
	}

	if (
		model.planningModelId === null &&
		model.revisionPlanningModelId === null &&
		model.executionModelId === null &&
		model.revisionExecutionModelId === null
	) {
		return null
	}

	return { ...model }
}

function normalizePlanConfig(config: PlanConfig): PlanConfig | null {
	if (config.model === null || config.model.planningModelId === null) {
		return null
	}

	return { model: { ...config.model } }
}

function validateActiveModel(model: Model): Result<void, ArchivedModelProviderReferenceError | ArchivedModelReferenceError> {
	if (isArchived(model.archivePeriods)) {
		return { ok: false, error: { type: 'archived-model-reference', modelId: model.id } }
	}

	return { ok: true, value: undefined }
}

function validateActiveModelProvider(provider: ModelProvider): Result<void, ArchivedModelProviderReferenceError> {
	if (isArchived(provider.archivePeriods)) {
		return { ok: false, error: { type: 'archived-model-provider-reference', modelProviderId: provider.id } }
	}

	return { ok: true, value: undefined }
}

function repositoryTargetKey(config: RepositoryConfig): string {
	return `${config.provider}:${config.owner.toLocaleLowerCase()}/${config.name.toLocaleLowerCase()}`
}

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
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
