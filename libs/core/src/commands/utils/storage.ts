import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './errors'
import type { AgentRunProfile } from '../../domain/agent-run-profile'
import type { ArchivePeriod, AuditStamp, Id } from '../../domain/commons'
import type { DeliveryConfig, DeliveryConfigRecord, ModelUseConfig, ProjectConfig, ProjectConfigRecord } from '../../domain/config'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { Model, ModelThinkingLevel } from '../../domain/model'
import type { ModelProvider, ModelProviderAuth, ModelProviderHeader } from '../../domain/model-provider'
import type { Project } from '../../domain/project'
import type { RepositoryConfig } from '../../domain/repository'
import type { Secret, SecretBindingScope } from '../../domain/secret'
import type {
	AlreadyArchivedError,
	ArchivableCoreResource,
	ArchivedAgentRunProfileReferenceError,
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	ArchivedSecretReferenceError,
	CoreIdResource,
	DeliveryWorkStateMismatchError,
	DuplicateRepositoryTargetError,
	DuplicateSecretBindingError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	NotArchivedError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../../errors'
import { validateModelThinkingLevelForUse } from '../../providers/model-provider-protocol/thinking'
import type { CoreRuntime } from '../../runtime'
import type { CoreStorage } from '../../services'
import {
	createRecord,
	getRecord,
	getRequired,
	listRecords,
	notFound,
	updateRecord,
	withTransaction,
	type StorageBoundaryError,
} from '../../storage/helpers'
import type { CoreIdStorageRecord } from '../../storage/schemas'
import { auditStamp, nextId, runtimeRecord } from '../../utils/runtime-values'
import type { Result } from '../../utils/types'
import type { CommandContext } from '../types'

export { auditStamp, createRecord, getRecord, getRequired, listRecords, nextId, notFound, runtimeRecord, updateRecord, withTransaction }

export type { StorageBoundaryError }

export type CommandBoundary<TInput> = {
	input: TInput
	context: CommandContext
}

export async function createRecordValue<Resource extends CoreIdResource>(
	resource: Resource,
	storage: CoreStorage,
	record: CoreIdStorageRecord<Resource>,
): Promise<Result<CoreIdStorageRecord<Resource>, StorageBoundaryError | InvariantViolationError>> {
	const stored = await createRecord(resource, storage, record)
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
	context: CommandContext,
	run: (storage: CoreStorage, stamp: AuditStamp) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return Promise.resolve(stamp)

	return withTransaction(runtime.services, (storage) => run(storage, stamp.value))
}

export function updateStoredRecordWithAudit<Resource extends CoreIdResource>(
	runtime: CoreRuntime,
	context: CommandContext,
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
	context: CommandContext,
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

export interface SelectableModelFacts {
	model: Model
	provider: ModelProvider
}

export async function loadSelectableModelFacts(
	storage: CoreStorage,
	modelIds: Id[],
): Promise<Result<Map<Id, SelectableModelFacts>, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const facts = new Map<Id, SelectableModelFacts>()
	const providers = new Map<Id, ModelProvider>()

	for (const modelId of uniqueIds(modelIds)) {
		const fact = await loadSelectableModelFact(storage, modelId, providers)
		if (!fact.ok) return fact

		facts.set(modelId, fact.value)
	}

	return { ok: true, value: facts }
}

async function loadSelectableModelFact(
	storage: CoreStorage,
	modelId: Id,
	providers: Map<Id, ModelProvider>,
): Promise<Result<SelectableModelFacts, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const modelResult = await getRequired('model', storage, modelId)
	if (!modelResult.ok) return modelResult

	const modelSelectability = validateActiveModel(modelResult.value)
	if (!modelSelectability.ok) return modelSelectability

	const providerResult = await loadSelectableModelProvider(storage, modelResult.value.providerId, providers)
	return providerResult.ok ? { ok: true, value: { model: modelResult.value, provider: providerResult.value } } : providerResult
}

export async function validateSelectableModels(
	storage: CoreStorage,
	modelIds: Id[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const facts = await loadSelectableModelFacts(storage, modelIds)
	return facts.ok ? { ok: true, value: undefined } : facts
}

export function validateModelUseConfigs(
	facts: Map<Id, SelectableModelFacts>,
	modelUses: ModelUseConfig[],
): Result<void, ModelThinkingLevelUnavailableError | InvariantViolationError> {
	for (const modelUse of modelUses) {
		const fact = facts.get(modelUse.modelId)
		if (fact === undefined) return invariant(`Selectable Model facts missing for ${modelUse.modelId}.`)

		const validation = validateModelThinkingLevel(fact.model, fact.provider, modelUse.thinkingLevel)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

export function validateModelThinkingLevel(
	model: Model,
	provider: ModelProvider,
	thinkingLevel: ModelThinkingLevel,
): Result<void, ModelThinkingLevelUnavailableError> {
	return validateModelThinkingLevelForUse(model, provider.protocol, thinkingLevel)
}

export async function loadSelectableAgentRunProfile(
	storage: CoreStorage,
	agentRunProfileId: Id,
): Promise<Result<AgentRunProfile, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const profile = await getRequired('agent-run-profile', storage, agentRunProfileId)
	if (!profile.ok) return profile
	if (isArchived(profile.value.archivePeriods)) return archivedAgentRunProfileReference(agentRunProfileId)

	const facts = await loadSelectableModelFacts(storage, [profile.value.modelUse.modelId])
	if (!facts.ok) return facts

	const modelUseValidation = validateModelUseConfigs(facts.value, [profile.value.modelUse])
	return modelUseValidation.ok ? profile : modelUseValidation
}

export async function validateSelectableAgentRunProfiles(
	storage: CoreStorage,
	agentRunProfileIds: Id[],
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	for (const agentRunProfileId of uniqueIds(agentRunProfileIds)) {
		const profile = await loadSelectableAgentRunProfile(storage, agentRunProfileId)
		if (!profile.ok) return profile
	}

	return { ok: true, value: undefined }
}

export function agentRunProfileSnapshot(profile: AgentRunProfile) {
	return { agentRunProfileId: profile.id, name: profile.name, modelUse: profile.modelUse }
}

export function agentRunProfileIdsFromProjectConfig(config: ProjectConfig): Id[] {
	return agentRunProfileIdsFromDeliveryWorkConfig(config.work)
}

export function agentRunProfileIdsFromProjectConfigRecord(config: ProjectConfigRecord): Id[] {
	return agentRunProfileIdsFromProjectConfig(config.value)
}

export function agentRunProfileIdsFromDeliveryConfig(config: DeliveryConfig | null): Id[] {
	return config?.work === undefined || config.work === null ? [] : agentRunProfileIdsFromDeliveryWorkConfig(config.work)
}

export function agentRunProfileIdsFromDeliveryConfigRecord(config: DeliveryConfigRecord): Id[] {
	return agentRunProfileIdsFromDeliveryConfig(config.value)
}

export function agentRunProfileIdsFromDeliveryWorkConfig(config: ProjectConfig['work']): Id[] {
	return [config.executionAgentRunProfileId, config.revisionExecutionAgentRunProfileId].filter(isId)
}

async function loadSelectableModelProvider(
	storage: CoreStorage,
	providerId: Id,
	cache: Map<Id, ModelProvider>,
): Promise<Result<ModelProvider, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const cached = cache.get(providerId)
	if (cached !== undefined) return { ok: true, value: cached }

	const providerResult = await getRequired('model-provider', storage, providerId)
	if (!providerResult.ok) return providerResult

	const providerSelectability = validateActiveModelProvider(providerResult.value)
	if (!providerSelectability.ok) return providerSelectability

	cache.set(providerId, providerResult.value)
	return providerResult
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
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
	context: CommandContext,
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
	context: CommandContext,
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

export function normalizeProjectConfigRecord(config: ProjectConfig, configured: AuditStamp): ProjectConfigRecord {
	return { configured, value: config }
}

export function normalizeDeliveryConfigRecord(config: DeliveryConfig | null, configured: AuditStamp): DeliveryConfigRecord {
	return { configured, value: config }
}

export function normalizeRepositoryConfig(config: RepositoryConfig): RepositoryConfig {
	return { ...config }
}

export function modelIdsFromModelUses(modelUses: ModelUseConfig[]): Id[] {
	return modelUses.map((modelUse) => modelUse.modelId)
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

export function archivedAgentRunProfileReference(agentRunProfileId: Id): Result<never, ArchivedAgentRunProfileReferenceError> {
	return { ok: false, error: { type: 'archived-agent-run-profile-reference', agentRunProfileId } }
}

function isId(id: Id | null): id is Id {
	return id !== null
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
