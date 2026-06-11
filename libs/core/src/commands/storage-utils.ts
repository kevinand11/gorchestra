import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
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
import { deliveryPipe, type Delivery, type DeliveryWorkState } from '../domain/delivery'
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
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { auditStamp, getRecord, getRequired, listRecords, nextId, notFound } from '../utils/storage'
import type { StorageBoundaryError } from '../utils/storage'
import type { Result } from '../utils/types'
import { deriveDeliveryWorkState } from '../utils/work-state'

export {
	auditStamp,
	getRequired,
	getRequiredSingleton,
	listRecords,
	nextId,
	notFound,
	putRecord,
	putSingleton,
	runtimeRecord,
	withTransaction,
} from '../utils/storage'

export type CommandBoundary<TInput> = {
	input: TInput
	context: OperationContext
}

type ArchivableRecord = { archivePeriods: ArchivePeriod[] }

export function prepareAuthorizedAction(
	options: OpenCoreOptions,
	context: OperationContext,
): Result<{ stamp: AuditStamp; actionId: Id }, InvalidCoreServiceOutputError> {
	const stampResult = auditStamp(options, context)
	if (!stampResult.ok) return stampResult

	const actionId = nextId(options, 'action')
	if (!actionId.ok) return actionId

	return { ok: true, value: { stamp: stampResult.value, actionId: actionId.value } }
}

export async function readDeliveryWorkState(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<
	Result<
		{ delivery: Delivery; state: DeliveryWorkState },
		InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError | InvariantViolationError
	>
> {
	const deliveryResult = await getRequired('delivery', tx.deliveries, deliveryId, deliveryPipe)
	if (!deliveryResult.ok) return deliveryResult

	const state = await deriveDeliveryWorkState(tx, deliveryId)
	if (!state.ok) return state

	return { ok: true, value: { delivery: deliveryResult.value, state: state.value } }
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
	tx: CoreStorageTransaction,
	modelIds: Id[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	for (const modelId of uniqueIds(modelIds)) {
		const validation = await validateSelectableModel(tx, modelId)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

async function validateSelectableModel(
	tx: CoreStorageTransaction,
	modelId: Id,
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const modelResult = await getRequired('model', tx.models, modelId, modelPipe)
	if (!modelResult.ok) return modelResult

	const modelSelectability = validateActiveModel(modelResult.value)
	if (!modelSelectability.ok) return modelSelectability

	return validateSelectableModelProvider(tx, modelResult.value.providerId)
}

async function validateSelectableModelProvider(
	tx: CoreStorageTransaction,
	providerId: Id,
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const providerResult = await getRequired('model-provider', tx.modelProviders, providerId, modelProviderPipe)
	if (!providerResult.ok) return providerResult

	return validateActiveModelProvider(providerResult.value)
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

export async function validateActiveSecretReferences(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	for (const secretId of secretIds) {
		const validation = await validateActiveSecretReference(tx, secretId)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

async function validateActiveSecretReference(
	tx: CoreStorageTransaction,
	secretId: Id,
): Promise<
	Result<void, ResourceNotFoundError | ArchivedSecretReferenceError | StorageOperationFailedError | InvalidCoreServiceOutputError>
> {
	const secret = await getRecord('secret', tx.secrets, secretId, secretPipe)
	if (!secret.ok) return secret
	if (secret.value === null) return notFound('secret', secretId)

	return isArchived(secret.value.archivePeriods) ? archivedSecretReference(secretId) : { ok: true, value: undefined }
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
