import type { ConfigCommandReferenceError, ConfigCommandStorageError } from './command-errors'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import {
	firstDuplicateRuntimeRequirement,
	type AgentRunRuntimeRequirement,
	type AgentRunSandboxConfig,
	type VercelSandboxCredentialsSecretRefs,
} from '../domain/agent-run-runtime'
import type { ArchivePeriod, AuditStamp, Id } from '../domain/commons'
import type { DeliveryConfig, DeliveryConfigRecord, ModelUseConfig, ProjectConfig, ProjectConfigRecord } from '../domain/config'
import type { DeliveryWorkState } from '../domain/delivery'
import type { Model, ModelThinkingLevel } from '../domain/model'
import {
	modelProviderProtocolForSource,
	type ModelProvider,
	type ModelProviderAccessValue,
	type ModelProviderAuth,
	type ModelProviderHeader,
} from '../domain/model-provider'
import type {
	ArchivableCoreResource,
	CoreIdResource,
	DeliveryWorkStateMismatchError,
	DuplicateAgentRunRuntimeRequirementError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ResourceArchivedError,
	ResourceNotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import { withNotificationTransaction, type NotificationEmitter } from './notifications'
import { validateModelThinkingLevelForUse } from './providers/model-provider-protocol/thinking'
import type { CoreRuntime } from './runtime'
import { validateRuntimeRequirementSecretReferences } from './runtime-requirement-secrets'
import { auditStamp, nextId, runtimeRecord } from './runtime-values'
import { validateActiveSecretReferences } from './secrets'
import {
	createRecord,
	getRecord,
	getRequired,
	listRecords,
	listRecordsByIds,
	notFound,
	updateRecord,
	withTransaction,
	type StorageBoundaryError,
} from './storage/helpers'
import type { CoreIdStorageRecord, CoreIdStorageRecordMap } from './storage/schema-registry'
import type { Result } from './types'
import type { CommandContext } from '../commands/types'

export {
	auditStamp,
	createRecord,
	getRecord,
	getRequired,
	listRecords,
	listRecordsByIds,
	nextId,
	notFound,
	runtimeRecord,
	updateRecord,
	withTransaction,
}

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
	run: (storage: CoreStorage, stamp: AuditStamp, notifications: NotificationEmitter) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | InvalidCoreServiceOutputError | StorageOperationFailedError>> {
	const stamp = auditStamp(runtime.values, context)
	if (!stamp.ok) return Promise.resolve(stamp)

	return withNotificationTransaction(runtime, (storage, notifications) => run(storage, stamp.value, notifications))
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

	const actionId = nextId(runtime.values)
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
	return validateModelThinkingLevelForUse(model, modelProviderProtocolForSource(provider.source), thinkingLevel)
}

export async function loadSelectableAgentRunProfile(
	storage: CoreStorage,
	agentRunProfileId: Id,
): Promise<Result<AgentRunProfile, ConfigCommandReferenceError | ConfigCommandStorageError>> {
	const profile = await getRequired('agent-run-profile', storage, agentRunProfileId)
	if (!profile.ok) return profile
	if (isArchived(profile.value.archivePeriods)) return resourceArchived('agent-run-profile', agentRunProfileId)

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
	return {
		agentRunProfileId: profile.id,
		name: profile.name,
		modelUse: profile.modelUse,
		runtimeRequirements: profile.runtimeRequirements,
		sandboxConfig: profile.sandboxConfig,
	}
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

export function isArchived(archivePeriods: ArchivePeriod[]): boolean {
	const latestPeriod = archivePeriods.at(-1)

	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

type ArchivableCoreStorageRecord = CoreIdStorageRecordMap[ArchivableCoreResource]

type ArchiveStoredRecordError = StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | ResourceArchivedError

type UnarchiveStoredRecordError = StorageBoundaryError | InvariantViolationError | ResourceNotFoundError | ResourceNotArchivedError

export function archiveStoredRecordWithAudit<Resource extends ArchivableCoreResource>(
	runtime: CoreRuntime,
	context: CommandContext,
	resource: Resource,
	id: Id,
): Promise<Result<CoreIdStorageRecord<Resource>, ArchiveStoredRecordError>>
export function archiveStoredRecordWithAudit(
	runtime: CoreRuntime,
	context: CommandContext,
	resource: ArchivableCoreResource,
	id: Id,
): Promise<Result<ArchivableCoreStorageRecord, ArchiveStoredRecordError>> {
	return withAuditStampTransaction<ArchivableCoreStorageRecord, ArchiveStoredRecordError>(runtime, context, async (storage, stamp) => {
		const existing = await getRequired(resource, storage, id)
		if (!existing.ok) return existing
		if (isArchived(existing.value.archivePeriods)) return { ok: false, error: { type: 'resource-archived', resource, id } }

		const archivePeriods = [...existing.value.archivePeriods, { archived: stamp, unarchived: null }]
		const stored = await updateRecordValue(resource, storage, existing.value.id, { archivePeriods })
		return stored.ok ? { ok: true, value: { ...existing.value, archivePeriods } } : stored
	})
}

export function unarchiveStoredRecordWithAudit<Resource extends ArchivableCoreResource>(
	runtime: CoreRuntime,
	context: CommandContext,
	resource: Resource,
	id: Id,
): Promise<Result<CoreIdStorageRecord<Resource>, UnarchiveStoredRecordError>>
export function unarchiveStoredRecordWithAudit(
	runtime: CoreRuntime,
	context: CommandContext,
	resource: ArchivableCoreResource,
	id: Id,
): Promise<Result<ArchivableCoreStorageRecord, UnarchiveStoredRecordError>> {
	return withAuditStampTransaction<ArchivableCoreStorageRecord, UnarchiveStoredRecordError>(runtime, context, async (storage, stamp) => {
		const existing = await getRequired(resource, storage, id)
		if (!existing.ok) return existing

		const latestPeriodIndex = existing.value.archivePeriods.length - 1
		const latestPeriod = existing.value.archivePeriods.at(-1)
		if (latestPeriod === undefined || latestPeriod.unarchived !== null) {
			return { ok: false, error: { type: 'resource-not-archived', resource, id } }
		}

		const archivePeriods = [...existing.value.archivePeriods]
		archivePeriods[latestPeriodIndex] = { ...latestPeriod, unarchived: stamp }
		const stored = await updateRecordValue(resource, storage, existing.value.id, { archivePeriods })
		return stored.ok ? { ok: true, value: { ...existing.value, archivePeriods } } : stored
	})
}

export function normalizeProjectConfigRecord(config: ProjectConfig, configured: AuditStamp): ProjectConfigRecord {
	return { configured, value: config }
}

export function normalizeDeliveryConfigRecord(config: DeliveryConfig | null, configured: AuditStamp): DeliveryConfigRecord {
	return { configured, value: config }
}

export function modelIdsFromModelUses(modelUses: ModelUseConfig[]): Id[] {
	return modelUses.map((modelUse) => modelUse.modelId)
}

export function secretReferencesFromModelProviderConfig(auth: ModelProviderAuth | null, headers: ModelProviderHeader[]): Id[] {
	return uniqueIds([
		...(auth === null ? [] : secretReferencesFromModelProviderAccessValue(auth.value)),
		...headers.flatMap((header) => secretReferencesFromModelProviderAccessValue(header.value)),
	])
}

export async function validateAgentRunProfileConfig(
	storage: CoreStorage,
	input: { modelUse: ModelUseConfig; runtimeRequirements: AgentRunRuntimeRequirement[]; sandboxConfig: AgentRunSandboxConfig },
): Promise<
	Result<void, ConfigCommandReferenceError | ConfigCommandStorageError | ResourceArchivedError | DuplicateAgentRunRuntimeRequirementError>
> {
	const duplicateRequirement = firstDuplicateRuntimeRequirement(input.runtimeRequirements)
	if (duplicateRequirement !== null) {
		return { ok: false, error: { type: 'duplicate-agent-run-runtime-requirement', requirement: duplicateRequirement } }
	}

	const facts = await loadSelectableModelFacts(storage, modelIdsFromModelUses([input.modelUse]))
	if (!facts.ok) return facts

	const modelUseValidation = validateModelUseConfigs(facts.value, [input.modelUse])
	if (!modelUseValidation.ok) return modelUseValidation

	const secretValidation = await validateRuntimeRequirementSecretReferences(storage, input.runtimeRequirements)
	if (!secretValidation.ok) return secretValidation

	return validateSandboxConfigSecretReferences(storage, input.sandboxConfig)
}

export function validateSandboxConfigSecretReferences(
	storage: CoreStorage,
	config: AgentRunSandboxConfig,
): Promise<Result<void, ConfigCommandReferenceError | ConfigCommandStorageError | ResourceArchivedError>> {
	switch (config.source.type) {
		case 'consumer-managed':
			return Promise.resolve({ ok: true, value: undefined })
		case 'vercel-runtime':
		case 'vercel-vcr-image':
			return validateActiveSecretReferences(storage, secretIdsFromVercelCredentials(config.source.credentials))
		default:
			throw new Error(`Unexpected Agent Run Sandbox source type: ${String(config.source satisfies never)}`)
	}
}

function secretIdsFromVercelCredentials(credentials: VercelSandboxCredentialsSecretRefs): Id[] {
	return uniqueIds([credentials.tokenSecretId, credentials.teamIdSecretId, credentials.projectIdSecretId])
}

function secretReferencesFromModelProviderAccessValue(value: ModelProviderAccessValue): Id[] {
	switch (value.type) {
		case 'secret':
			return [value.secretId]
		default:
			throw new Error('Unexpected Model Provider access value.')
	}
}

function resourceArchived(resource: ArchivableCoreResource, id: Id): Result<never, ResourceArchivedError> {
	return { ok: false, error: { type: 'resource-archived', resource, id } }
}

function isId(id: Id | null): id is Id {
	return id !== null
}

function validateActiveModel(model: Model): Result<void, ResourceArchivedError> {
	return isArchived(model.archivePeriods) ? resourceArchived('model', model.id) : { ok: true, value: undefined }
}

function validateActiveModelProvider(provider: ModelProvider): Result<void, ResourceArchivedError> {
	return isArchived(provider.archivePeriods) ? resourceArchived('model-provider', provider.id) : { ok: true, value: undefined }
}

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
}
