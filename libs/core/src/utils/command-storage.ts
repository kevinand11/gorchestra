import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './command-errors'
import type { ArchivePeriod, AuditStamp, Id, OperationContext } from '../domain/commons'
import type {
	DeliveryConfig,
	DeliveryConfigRecord,
	PlanConfig,
	PlanConfigRecord,
	PortfolioConfig,
	ProjectConfig,
	ProjectConfigRecord,
} from '../domain/config'
import type { DeliveryWorkState } from '../domain/delivery'
import type { Model } from '../domain/model'
import type { ModelProvider, ModelProviderAuth, ModelProviderHeader } from '../domain/model-provider'
import type { Project } from '../domain/project'
import type { RepositoryConfig } from '../domain/repository'
import type { Secret, SecretBindingScope } from '../domain/secret'
import type {
	AlreadyArchivedError,
	ArchivableCoreResource,
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	ArchivedSecretReferenceError,
	CoreIdResource,
	DeliveryWorkStateMismatchError,
	DuplicateRepositoryTargetError,
	DuplicateSecretBindingError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	NotArchivedError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import {
	createRecord,
	getRecord,
	getRequired,
	getRequiredPortfolioConfig,
	listRecords,
	notFound,
	setPortfolioConfig,
	updateRecord,
	withTransaction,
	type StorageBoundaryError,
} from '../storage/helpers'
import type { CoreIdStorageRecord, CoreStorageRecord } from '../storage/schemas'
import { auditStamp, nextId, runtimeRecord } from '../utils/runtime-values'
import type { Result } from '../utils/types'

export {
	auditStamp,
	createRecord,
	getRecord,
	getRequired,
	getRequiredPortfolioConfig,
	listRecords,
	nextId,
	notFound,
	runtimeRecord,
	setPortfolioConfig,
	updateRecord,
	withTransaction,
}

export type { StorageBoundaryError }

export type CommandBoundary<TInput> = {
	input: TInput
	context: OperationContext
}

export async function createRecordValue<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	record: CoreIdStorageRecord<Resource>,
): Promise<Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError>> {
	const stored = await createRecord(resource, storage, record as CoreStorageRecord<Resource>)
	return stored.ok ? { ok: true, value: stored.value } : stored
}

export async function updateRecordValue<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	id: Id,
	patch: Partial<CoreIdStorageRecord<Resource>>,
): Promise<Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError | ResourceNotFoundError>> {
	const stored = await updateRecord(resource, storage, id, patch)
	return stored.ok ? { ok: true, value: stored.value } : stored
}

export function withAuditStampTransaction<TValue, TError>(
	runtime: CoreRuntime,
	context: OperationContext,
	run: (storage: CoreStorage, stamp: AuditStamp) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return Promise.resolve(stamp)

	return withTransaction(runtime.services, (storage) => run(storage, stamp.value))
}

export function updateStoredRecordWithAudit<Resource extends CoreIdResource>(
	runtime: CoreRuntime,
	context: OperationContext,
	resource: Resource,
	id: Id,
	update: (record: CoreIdStorageRecord<Resource>, stamp: AuditStamp) => CoreIdStorageRecord<Resource>,
): Promise<
	Result<
		CoreIdStorageRecord<Resource>,
		StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | InvalidCoreServiceOutputError
	>
> {
	return withAuditStampTransaction(runtime, context, async (storage, stamp) => {
		const existing = await getRequired(resource, storage, id)
		if (!existing.ok) return existing

		const updated = update(existing.value, stamp)
		return updateRecordValue(resource, storage, id, updated)
	})
}

export function prepareAuthorizedAction(
	runtime: CoreRuntime,
	context: OperationContext,
): Result<{ stamp: AuditStamp; actionId: Id }, InvalidCoreServiceOutputError> {
	const stampResult = auditStamp(runtime.values, context)
	if (!stampResult.ok) return stampResult

	const actionId = nextId(runtime.values, 'action')
	if (!actionId.ok) return actionId

	return { ok: true, value: { stamp: stampResult.value, actionId: actionId.value } }
}

export function deliveryWorkStateMismatch(
	deliveryId: Id,
	expected: DeliveryWorkState['type'][],
	actual: DeliveryWorkState,
): Result<never, DeliveryWorkStateMismatchError> {
	return {
		ok: false,
		error: {
			type: 'delivery-work-state-mismatch',
			deliveryId,
			expected,
			actual,
		},
	}
}

export async function validateSelectableModels(
	storage: CoreStorage,
	modelIds: Id[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	for (const modelId of uniqueIds(modelIds)) {
		const validation = await validateSelectableModel(storage, modelId)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

async function validateSelectableModel(
	storage: CoreStorage,
	modelId: Id,
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const modelResult = await getRequired('model', storage, modelId)
	if (!modelResult.ok) return modelResult

	const modelSelectability = validateActiveModel(modelResult.value)
	if (!modelSelectability.ok) return modelSelectability

	return validateSelectableModelProvider(storage, modelResult.value.providerId)
}

async function validateSelectableModelProvider(
	storage: CoreStorage,
	providerId: Id,
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const providerResult = await getRequired('model-provider', storage, providerId)
	if (!providerResult.ok) return providerResult

	return validateActiveModelProvider(providerResult.value)
}

export async function validateSourceControlProject(
	storage: CoreStorage,
	projectId: Id,
): Promise<Result<Project, StorageBoundaryError | ResourceNotFoundError | ProjectSourceTypeMismatchError>> {
	const projectResult = await getRequired('project', storage, projectId)
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
	storage: CoreStorage,
	secretId: Id,
): Promise<Result<Secret, StorageBoundaryError | ResourceNotFoundError | SecretNotActiveError>> {
	const secretResult = await getRequired('secret', storage, secretId)
	if (!secretResult.ok) return secretResult
	if (isArchived(secretResult.value.archivePeriods)) {
		return { ok: false, error: { type: 'secret-not-active', secretId } }
	}

	return secretResult
}

export async function validateActiveSecretReferences(
	storage: CoreStorage,
	secretIds: Id[],
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	for (const secretId of secretIds) {
		const validation = await validateActiveSecretReference(storage, secretId)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

export function validateActiveModelProviderSecretReferences(
	storage: CoreStorage,
	auth: ModelProviderAuth | null,
	headers: ModelProviderHeader[],
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	return validateActiveSecretReferences(storage, secretReferencesFromModelProviderConfig(auth, headers))
}

export async function createValidModelProvider(
	storage: CoreStorage,
	provider: ModelProvider,
): Promise<
	Result<
		ModelProvider,
		| ResourceNotFoundError
		| ArchivedSecretReferenceError
		| StorageOperationFailedError
		| InvalidCoreServiceOutputError
		| InvariantViolationError
	>
> {
	const validReferences = await validateActiveModelProviderSecretReferences(storage, provider.auth, provider.headers)
	if (!validReferences.ok) return validReferences

	return createRecordValue('model-provider', storage, provider)
}

async function validateActiveSecretReference(
	storage: CoreStorage,
	secretId: Id,
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	const secret = await getRecord('secret', storage, secretId)
	if (!secret.ok) return secret
	if (secret.value === null) return notFound('secret', secretId)

	return isArchived(secret.value.archivePeriods) ? archivedSecretReference(secretId) : { ok: true, value: undefined }
}

export async function validateUniqueRepositoryTarget(
	storage: CoreStorage,
	projectId: Id,
	config: RepositoryConfig,
	excludeRepositoryId: Id | null,
): Promise<Result<void, StorageBoundaryError | DuplicateRepositoryTargetError>> {
	const repositoriesResult = await listRecords('repository', storage, {
		where: (filter, fields) => filter.eq(fields.projectId, projectId),
	})
	if (!repositoriesResult.ok) return repositoriesResult

	const target = repositoryTargetKey(config)
	const duplicate = repositoriesResult.value.find(
		(repository) => repository.id !== excludeRepositoryId && repositoryTargetKey(repository.config) === target,
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

export function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	const latestPeriod = archivePeriods.at(-1)

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

export function archiveStoredRecordWithAudit<Resource extends ArchivableCoreResource>(
	runtime: CoreRuntime,
	context: OperationContext,
	resource: Resource,
	id: Id,
): Promise<
	Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | AlreadyArchivedError>
> {
	return withAuditStampTransaction(
		runtime,
		context,
		async (
			storage,
			stamp,
		): Promise<
			Result<
				CoreIdStorageRecord<Resource>,
				StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | AlreadyArchivedError
			>
		> => {
			const existing = await getRequired(resource, storage, id)
			if (!existing.ok) return existing
			if (isArchived(existing.value.archivePeriods)) return { ok: false, error: { type: 'already-archived', resource, id } }

			const archived: CoreIdStorageRecord<Resource> = {
				...existing.value,
				archivePeriods: [...existing.value.archivePeriods, { archived: stamp, unarchived: null }],
			}
			const stored = await updateRecordValue(resource, storage, archived.id, { archivePeriods: archived.archivePeriods } as Partial<
				CoreIdStorageRecord<Resource>
			>)
			if (!stored.ok) return stored

			return { ok: true, value: archived }
		},
	)
}

export function unarchiveStoredRecordWithAudit<Resource extends ArchivableCoreResource>(
	runtime: CoreRuntime,
	context: OperationContext,
	resource: Resource,
	id: Id,
): Promise<
	Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | NotArchivedError>
> {
	return withAuditStampTransaction(
		runtime,
		context,
		async (
			storage,
			stamp,
		): Promise<
			Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | NotArchivedError>
		> => {
			const existing = await getRequired(resource, storage, id)
			if (!existing.ok) return existing

			if (!isArchived(existing.value.archivePeriods)) return { ok: false, error: { type: 'not-archived', resource, id } }

			const latestPeriodIndex = existing.value.archivePeriods.length - 1
			const latestPeriod = existing.value.archivePeriods[latestPeriodIndex] as ArchivePeriod
			const archivePeriods = [...existing.value.archivePeriods]
			archivePeriods[latestPeriodIndex] = { ...latestPeriod, unarchived: stamp }
			const unarchived: CoreIdStorageRecord<Resource> = { ...existing.value, archivePeriods }
			const stored = await updateRecordValue(resource, storage, unarchived.id, { archivePeriods } as Partial<
				CoreIdStorageRecord<Resource>
			>)
			if (!stored.ok) return stored

			return { ok: true, value: unarchived }
		},
	)
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

export function normalizeDeliveryConfigRecord(config: DeliveryConfig, configured: AuditStamp): DeliveryConfigRecord {
	return { configured, value: normalizeDeliveryConfig(config) }
}

export function normalizeDeliveryConfig(config: DeliveryConfig): DeliveryConfig | null {
	const model = normalizeDeliveryModelConfig(config.model)
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

export function modelIdsFromProjectConfigRecord(config: ProjectConfigRecord | null): Id[] {
	const model = config?.value?.model ?? null

	return model === null
		? []
		: nullableIds([model.planningModelId, model.revisionPlanningModelId, model.executionModelId, model.revisionExecutionModelId])
}

export function modelIdsFromPlanConfigRecord(config: PlanConfigRecord): Id[] {
	if (config.value === null || config.value.model === null || config.value.model.planningModelId === null) {
		return []
	}

	return [config.value.model.planningModelId]
}

export function modelIdsFromDeliveryConfigRecord(config: DeliveryConfigRecord): Id[] {
	const model = config.value?.model ?? null

	return model === null ? [] : nullableIds([model.revisionPlanningModelId, model.executionModelId, model.revisionExecutionModelId])
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

export function scopesEqual(left: SecretBindingScope, right: SecretBindingScope): boolean {
	return secretBindingScopeKey(left) === secretBindingScopeKey(right)
}

function secretBindingScopeKey(scope: SecretBindingScope): string {
	switch (scope.type) {
		case 'portfolio':
			return 'portfolio'
		case 'project':
			return `project:${scope.projectId}`
		case 'delivery':
			return `delivery:${scope.deliveryId}`
	}
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

function normalizeProjectModelConfig(model: ProjectConfig['model']): ProjectConfig['model'] {
	return model === null || !hasAnyProjectModelId(model) ? null : { ...model }
}

function normalizeDeliveryModelConfig(model: DeliveryConfig['model']): DeliveryConfig['model'] {
	return model === null || !hasAnyDeliveryModelId(model) ? null : { ...model }
}

function hasAnyProjectModelId(model: NonNullable<ProjectConfig['model']>): boolean {
	return (
		nullableIds([model.planningModelId, model.revisionPlanningModelId, model.executionModelId, model.revisionExecutionModelId]).length >
		0
	)
}

function hasAnyDeliveryModelId(model: NonNullable<DeliveryConfig['model']>): boolean {
	return nullableIds([model.revisionPlanningModelId, model.executionModelId, model.revisionExecutionModelId]).length > 0
}

function nullableIds(modelIds: Array<Id | null>): Id[] {
	return modelIds.filter((modelId): modelId is Id => modelId !== null)
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
