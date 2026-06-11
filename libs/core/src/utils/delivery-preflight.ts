import { getRequired, getRequiredSingleton } from './storage'
import type { Result } from './types'
import type { Id } from '../domain/commons'
import { portfolioConfigRecordPipe, type DeliveryWorkConfig, type PortfolioConfigRecord, type ProjectConfigRecord } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { ValidationEvidence } from '../domain/evidence'
import { modelPipe, type Model } from '../domain/model'
import { modelProviderPipe, type ModelProvider, type ModelProviderHeader } from '../domain/model-provider'
import { projectPipe, type Project } from '../domain/project'
import { repositoryPipe, type Repository } from '../domain/repository'
import type {
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { validateActiveSecret } from './command-storage'

export interface PassedDeliveryPreflight {
	type: 'passed'
	modelId: Id
	workConfig: DeliveryWorkConfig
	checks: ValidationEvidence[]
}

export type FailedDeliveryPreflightReason =
	| { type: 'portfolio-config-missing'; error: SingletonNotFoundError }
	| { type: 'model-archived'; error: ArchivedModelReferenceError }
	| { type: 'model-provider-archived'; error: ArchivedModelProviderReferenceError }
	| { type: 'work-config-unresolved' }

export interface FailedDeliveryPreflight {
	type: 'failed'
	checks: ValidationEvidence[]
	reason: FailedDeliveryPreflightReason
	snapshot: DeliveryPreflightSnapshot
}

export type DeliveryPreflightSnapshot = string

export type DeliveryPreflight = PassedDeliveryPreflight | FailedDeliveryPreflight

export type DeliveryPreflightError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError

export type RepositoryDeliveryPreflightPlan = { type: 'check'; check: ValidationEvidence } | { type: 'provider'; repository: Repository }

export type ModelDeliveryPreflightPlan =
	| { type: 'check'; check: ValidationEvidence }
	| { type: 'provider'; model: Model; modelProvider: ModelProvider }

export type ProviderBackedDeliveryPreflightPlan =
	| { type: 'local-failed'; checks: ValidationEvidence[]; snapshot: DeliveryPreflightSnapshot }
	| {
			type: 'provider-plan'
			repositoryId: Id
			resolution: PassedDeliveryPreflight
			repository: RepositoryDeliveryPreflightPlan
			model: ModelDeliveryPreflightPlan
			snapshot: DeliveryPreflightSnapshot
	  }

interface DeliveryConfigFacts {
	project: Project
	portfolioConfig: PortfolioConfigRecord
}

type PreflightStep<T> = Result<T | FailedDeliveryPreflight, DeliveryPreflightError>

const summaries = {
	portfolioConfigMissing: 'Portfolio Config is not configured.',
	modelArchived: 'Selected Delivery execution Model is archived.',
	modelProviderArchived: 'Selected Delivery execution Model Provider is archived.',
	workConfigUnresolved: 'Delivery Work Config is not resolved.',
} as const

export async function preflightDeliveryWork(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<DeliveryPreflight, DeliveryPreflightError>> {
	const facts = await deliveryConfigFacts(tx, delivery)
	if (!facts.ok) return facts
	if (isFailedDeliveryPreflight(facts.value)) return ok(facts.value)

	return preflightWithFacts(tx, delivery, facts.value)
}

export async function readProviderBackedDeliveryPreflightPlan(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const localPreflight = await preflightDeliveryWork(tx, delivery)
	if (!localPreflight.ok) return localPreflight

	return localPreflight.value.type === 'failed'
		? ok({ type: 'local-failed', checks: localPreflight.value.checks, snapshot: localPreflight.value.snapshot })
		: readProviderBackedPlanAfterLocalPreflight(tx, delivery, localPreflight.value)
}

async function readProviderBackedPlanAfterLocalPreflight(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	localPreflight: PassedDeliveryPreflight,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const repository = await readRepositoryPlan(tx, delivery)
	if (!repository.ok) return repository

	const model = await readModelPlan(tx, localPreflight.modelId)
	return model.ok ? ok(providerBackedPlan(delivery, localPreflight, repository.value, model.value)) : model
}

function providerBackedPlan(
	delivery: Delivery,
	resolution: PassedDeliveryPreflight,
	repository: RepositoryDeliveryPreflightPlan,
	model: ModelDeliveryPreflightPlan,
): ProviderBackedDeliveryPreflightPlan {
	return {
		type: 'provider-plan',
		repositoryId: delivery.target.repositoryId,
		resolution,
		repository,
		model,
		snapshot: deliveryPreflightSnapshot({
			type: 'provider-plan',
			repositoryId: delivery.target.repositoryId,
			modelId: resolution.modelId,
			workConfig: resolution.workConfig,
			repository,
			model,
		}),
	}
}

export async function runProviderBackedDeliveryPreflightChecks(
	runtime: CoreRuntime,
	plan: ProviderBackedDeliveryPreflightPlan,
): Promise<Result<ValidationEvidence[], DeliveryPreflightError>> {
	if (plan.type === 'local-failed') return ok(plan.checks)

	const [repository, model] = await Promise.all([runRepositoryCheck(runtime, plan.repository), runModelCheck(runtime, plan.model)])
	if (!repository.ok) return repository
	if (!model.ok) return model

	return ok([repository.value, model.value])
}

export function deliveryPreflightChecksPassed(checks: ValidationEvidence[]): boolean {
	return checks.length > 0 && checks.every((check) => check.passed)
}

export async function providerBackedDeliveryPreflightInputsStillCurrent(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	plan: ProviderBackedDeliveryPreflightPlan,
): Promise<Result<boolean, DeliveryPreflightError>> {
	const current = await readProviderBackedDeliveryPreflightPlan(tx, delivery)
	return current.ok ? ok(current.value.snapshot === plan.snapshot) : current
}

export function providerBackedDeliveryWorkResolution(plan: ProviderBackedDeliveryPreflightPlan) {
	return plan.type === 'provider-plan' ? { modelId: plan.resolution.modelId, workConfig: plan.resolution.workConfig } : undefined
}

async function readRepositoryPlan(
	tx: CoreStorageTransaction,
	delivery: Delivery,
): Promise<Result<RepositoryDeliveryPreflightPlan, DeliveryPreflightError>> {
	const repository = await getRequired('repository', tx.repositories, delivery.target.repositoryId, repositoryPipe)
	if (!repository.ok) return repository

	const secret = await validateActiveSecret(tx, repository.value.config.secretId)
	if (!secret.ok) return mapRepositoryAccessSecretFailure(secret.error)

	return ok({ type: 'provider', repository: repository.value })
}

async function readModelPlan(tx: CoreStorageTransaction, modelId: Id): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	const facts = await readModelPlanFacts(tx, modelId)
	return facts.ok ? readModelPlanWithFacts(tx, facts.value.model, facts.value.modelProvider) : facts
}

async function readModelPlanFacts(
	tx: CoreStorageTransaction,
	modelId: Id,
): Promise<Result<{ model: Model; modelProvider: ModelProvider }, DeliveryPreflightError>> {
	const model = await getRequired('model', tx.models, modelId, modelPipe)
	if (!model.ok) return model

	const modelProvider = await getRequired('model-provider', tx.modelProviders, model.value.providerId, modelProviderPipe)
	return modelProvider.ok ? ok({ model: model.value, modelProvider: modelProvider.value }) : modelProvider
}

async function readModelPlanWithFacts(
	tx: CoreStorageTransaction,
	model: Model,
	modelProvider: ModelProvider,
): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	const authSecret = await readModelProviderAuthSecretCheck(tx, modelProvider)
	if (!authSecret.ok) return authSecret
	if (authSecret.value !== null) return ok({ type: 'check', check: authSecret.value })

	return readModelProviderHeaderSecretPlan(tx, model, modelProvider)
}

async function readModelProviderAuthSecretCheck(
	tx: CoreStorageTransaction,
	modelProvider: ModelProvider,
): Promise<Result<ValidationEvidence | null, DeliveryPreflightError>> {
	if (modelProvider.auth === null) return ok(null)

	const secret = await validateActiveSecret(tx, modelProvider.auth.secretId)
	return secret.ok ? ok(null) : mapModelProviderAuthSecretFailure(modelProvider, secret.error)
}

async function readModelProviderHeaderSecretPlan(
	tx: CoreStorageTransaction,
	model: Model,
	modelProvider: ModelProvider,
): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	for (const header of modelProvider.headers) {
		const secret = await validateActiveSecret(tx, header.valueSecretId)
		if (!secret.ok) return mapModelProviderHeaderSecretFailure(modelProvider, header, secret.error)
	}

	return ok({ type: 'provider', model, modelProvider })
}

function mapRepositoryAccessSecretFailure(
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<RepositoryDeliveryPreflightPlan, DeliveryPreflightError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return ok({
			type: 'check',
			check: validationEvidence('repository-preflight', false, 'GitHub repository access Secret is missing.'),
		})
	}
	if (error.type === 'secret-not-active') {
		return ok({
			type: 'check',
			check: validationEvidence('repository-preflight', false, 'GitHub repository access Secret is not active.'),
		})
	}

	return { ok: false, error }
}

function mapModelProviderAuthSecretFailure(
	modelProvider: ModelProvider,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<ValidationEvidence | null, DeliveryPreflightError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return ok(validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'auth', 'missing')))
	}
	if (error.type === 'secret-not-active') {
		return ok(validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'auth', 'inactive')))
	}

	return { ok: false, error }
}

function mapModelProviderHeaderSecretFailure(
	modelProvider: ModelProvider,
	_header: ModelProviderHeader,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<ModelDeliveryPreflightPlan, DeliveryPreflightError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return ok({
			type: 'check',
			check: validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'header', 'missing')),
		})
	}
	if (error.type === 'secret-not-active') {
		return ok({
			type: 'check',
			check: validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'header', 'inactive')),
		})
	}

	return { ok: false, error }
}

async function runRepositoryCheck(
	runtime: CoreRuntime,
	plan: RepositoryDeliveryPreflightPlan,
): Promise<Result<ValidationEvidence, DeliveryPreflightError>> {
	if (plan.type === 'check') return ok(plan.check)

	const preflight = await runtime.providers.sourceControl.preflightRepository({ repository: plan.repository })
	return preflight.ok
		? ok(validationEvidence('repository-preflight', preflight.value.type === 'passed', preflight.value.summary))
		: preflight
}

async function runModelCheck(
	runtime: CoreRuntime,
	plan: ModelDeliveryPreflightPlan,
): Promise<Result<ValidationEvidence, DeliveryPreflightError>> {
	if (plan.type === 'check') return ok(plan.check)

	const preflight = await runtime.providers.modelProviderProtocols.preflightModel({
		model: plan.model,
		modelProvider: plan.modelProvider,
	})
	return preflight.ok ? ok(validationEvidence('model-preflight', preflight.value.type === 'passed', preflight.value.summary)) : preflight
}

function modelSecretSummary(modelProvider: ModelProvider, secretKind: 'auth' | 'header', state: 'missing' | 'inactive'): string {
	const providerName = protocolDisplayName(modelProvider)
	const noun = secretKind === 'auth' ? 'auth Secret' : 'header Secret'
	return `${providerName} model provider ${noun} is ${state === 'missing' ? 'missing' : 'not active'}.`
}

function protocolDisplayName(modelProvider: ModelProvider): string {
	const names: Record<ModelProvider['protocol'], string> = {
		'anthropic-messages': 'Anthropic Messages',
		'openai-responses': 'OpenAI Responses',
		'openai-completions': 'OpenAI Completions',
		'google-generative-ai': 'Google Generative AI',
	}

	return names[modelProvider.protocol]
}

async function preflightWithFacts(
	tx: CoreStorageTransaction,
	delivery: Delivery,
	facts: DeliveryConfigFacts,
): Promise<Result<DeliveryPreflight, DeliveryPreflightError>> {
	const modelId = resolveExecutionModelId(delivery, facts.project, facts.portfolioConfig)
	const modelValidation = await validateSelectableModel(tx, modelId)
	if (!modelValidation.ok) return modelValidation
	if (isFailedDeliveryPreflight(modelValidation.value)) return ok(modelValidation.value)

	return resolvedWorkConfig(delivery, facts.project.config, facts.portfolioConfig, modelId)
}

async function deliveryConfigFacts(tx: CoreStorageTransaction, delivery: Delivery): Promise<PreflightStep<DeliveryConfigFacts>> {
	const project = await deliveryProject(tx, delivery)
	return project.ok ? deliveryConfigFactsWithProject(tx, project.value) : project
}

async function deliveryConfigFactsWithProject(tx: CoreStorageTransaction, project: Project): Promise<PreflightStep<DeliveryConfigFacts>> {
	const portfolioConfig = await deliveryPortfolioConfig(tx)
	if (!portfolioConfig.ok) return portfolioConfig

	return isFailedDeliveryPreflight(portfolioConfig.value)
		? ok(portfolioConfig.value)
		: ok({ project, portfolioConfig: portfolioConfig.value })
}

async function deliveryProject(tx: CoreStorageTransaction, delivery: Delivery): Promise<Result<Project, DeliveryPreflightError>> {
	return getRequired('project', tx.projects, delivery.projectId, projectPipe)
}

async function deliveryPortfolioConfig(tx: CoreStorageTransaction): Promise<PreflightStep<PortfolioConfigRecord>> {
	const portfolioConfig = await getRequiredSingleton('portfolio-config', tx.portfolioConfig, portfolioConfigRecordPipe)
	return portfolioConfig.ok ? ok(portfolioConfig.value) : mapMissingPortfolioConfig(portfolioConfig.error)
}

async function validateSelectableModel(tx: CoreStorageTransaction, modelId: Id): Promise<PreflightStep<{ type: 'passed' }>> {
	const model = await selectedModel(tx, modelId)
	if (!model.ok) return model
	if (isFailedDeliveryPreflight(model.value)) return ok(model.value)

	return selectedModelProvider(tx, model.value.providerId)
}

async function selectedModel(tx: CoreStorageTransaction, modelId: Id): Promise<PreflightStep<Model>> {
	const model = await getRequired('model', tx.models, modelId, modelPipe)
	if (!model.ok) return model

	return isArchived(model.value) ? ok(modelArchived(modelId)) : ok(model.value)
}

async function selectedModelProvider(tx: CoreStorageTransaction, providerId: Id): Promise<PreflightStep<{ type: 'passed' }>> {
	const provider = await getRequired('model-provider', tx.modelProviders, providerId, modelProviderPipe)
	if (!provider.ok) return provider

	return isArchived(provider.value) ? ok(modelProviderArchived(provider.value.id)) : ok({ type: 'passed' })
}

function resolvedWorkConfig(
	delivery: Delivery,
	projectConfig: ProjectConfigRecord | null,
	portfolioConfig: PortfolioConfigRecord,
	modelId: Id,
): Result<DeliveryPreflight, never> {
	const workConfig = resolveDeliveryWorkConfig(delivery, projectConfig, portfolioConfig)
	return workConfig === null
		? ok(
				failedPreflight(
					summaries.workConfigUnresolved,
					{ type: 'work-config-unresolved' },
					unresolvedWorkConfigSnapshot(delivery, projectConfig, portfolioConfig, modelId),
				),
			)
		: ok({ type: 'passed', modelId, workConfig, checks: [deliveryPreflightEvidence(true, 'Delivery preflight passed.')] })
}

function mapMissingPortfolioConfig(error: SingletonNotFoundError | DeliveryPreflightError): PreflightStep<PortfolioConfigRecord> {
	return error.type === 'not-found-singleton' ? ok(portfolioConfigMissing(error)) : { ok: false, error }
}

function isFailedDeliveryPreflight(value: unknown): value is FailedDeliveryPreflight {
	return typeof value === 'object' && value !== null && 'type' in value && value.type === 'failed'
}

function portfolioConfigMissing(error: SingletonNotFoundError): FailedDeliveryPreflight {
	return failedPreflight(summaries.portfolioConfigMissing, { type: 'portfolio-config-missing', error })
}

function modelArchived(modelId: Id): FailedDeliveryPreflight {
	return failedPreflight(
		summaries.modelArchived,
		{ type: 'model-archived', error: { type: 'archived-model-reference', modelId } },
		{ type: 'model-archived', modelId },
	)
}

function modelProviderArchived(modelProviderId: Id): FailedDeliveryPreflight {
	return failedPreflight(
		summaries.modelProviderArchived,
		{
			type: 'model-provider-archived',
			error: { type: 'archived-model-provider-reference', modelProviderId },
		},
		{ type: 'model-provider-archived', modelProviderId },
	)
}

function failedPreflight(
	summary: string,
	reason: FailedDeliveryPreflightReason,
	snapshotInput: unknown = reason.type,
): FailedDeliveryPreflight {
	return {
		type: 'failed',
		checks: [deliveryPreflightEvidence(false, summary)],
		reason,
		snapshot: deliveryPreflightSnapshot(snapshotInput),
	}
}

function deliveryPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return validationEvidence('delivery-preflight', passed, summary)
}

function validationEvidence(operation: ValidationEvidence['operation']['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
}

function resolveExecutionModelId(delivery: Delivery, project: Project, portfolioConfig: PortfolioConfigRecord): Id {
	return firstPresent([
		delivery.config?.value?.model?.executionModelId,
		project.config?.value?.model?.executionModelId,
		portfolioConfig.value.model.executionModelId,
		portfolioConfig.value.model.defaultModelId,
	])
}

function resolveDeliveryWorkConfig(
	delivery: Delivery,
	projectConfig: ProjectConfigRecord | null,
	portfolioConfig: PortfolioConfigRecord,
): DeliveryWorkConfig | null {
	return firstOptional([delivery.config?.value?.work, projectConfig?.value?.work, portfolioConfig.value.work])
}

function unresolvedWorkConfigSnapshot(
	delivery: Delivery,
	projectConfig: ProjectConfigRecord | null,
	portfolioConfig: PortfolioConfigRecord,
	modelId: Id,
) {
	return {
		type: 'work-config-unresolved',
		modelId,
		deliveryWorkConfig: deliveryWorkConfigValue(delivery),
		projectWorkConfig: projectWorkConfigValue(projectConfig),
		portfolioWorkConfig: portfolioConfig.value.work,
	}
}

function deliveryWorkConfigValue(delivery: Delivery): DeliveryWorkConfig | null {
	return delivery.config === null ? null : (delivery.config.value?.work ?? null)
}

function projectWorkConfigValue(projectConfig: ProjectConfigRecord | null): DeliveryWorkConfig | null {
	return projectConfig === null ? null : (projectConfig.value?.work ?? null)
}

function deliveryPreflightSnapshot(value: unknown): DeliveryPreflightSnapshot {
	return JSON.stringify(value)
}

function firstPresent<T>(values: Array<T | null | undefined>): T {
	const value = values.find((candidate): candidate is T => candidate !== null && candidate !== undefined)
	if (value === undefined) throw new Error('Expected at least one required fallback value.')

	return value
}

function firstOptional<T>(values: Array<T | null | undefined>): T | null {
	return values.find((candidate): candidate is T => candidate !== null && candidate !== undefined) ?? null
}

function isArchived(record: Model | ModelProvider): boolean {
	return record.archivePeriods.at(-1)?.unarchived === null
}

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}
