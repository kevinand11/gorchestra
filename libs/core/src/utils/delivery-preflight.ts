import { getRequired, getRequiredSingleton } from './storage'
import type { Result } from './types'
import type { Id } from '../domain/commons'
import { portfolioConfigRecordPipe, type DeliveryWorkConfig, type PortfolioConfigRecord, type ProjectConfigRecord } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import { modelPipe, type Model } from '../domain/model'
import { modelProviderPipe, type ModelProvider } from '../domain/model-provider'
import { projectPipe, type Project } from '../domain/project'
import type {
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction } from '../services'

export interface PassedDeliveryPreflight {
	type: 'passed'
	modelId: Id
	workConfig: DeliveryWorkConfig
}

export type FailedDeliveryPreflightReason =
	| { type: 'portfolio-config-missing'; error: SingletonNotFoundError }
	| { type: 'project-missing'; error: ResourceNotFoundError }
	| { type: 'model-missing'; error: ResourceNotFoundError }
	| { type: 'model-archived'; error: ArchivedModelReferenceError }
	| { type: 'model-provider-archived'; error: ArchivedModelProviderReferenceError }
	| { type: 'work-config-unresolved' }

export interface FailedDeliveryPreflight {
	type: 'failed'
	summary: string
	reason: FailedDeliveryPreflightReason
}

export type DeliveryPreflight = PassedDeliveryPreflight | FailedDeliveryPreflight

export type DeliveryPreflightError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError

interface DeliveryConfigFacts {
	project: Project
	portfolioConfig: PortfolioConfigRecord
}

type PreflightStep<T> = Result<T | FailedDeliveryPreflight, DeliveryPreflightError>

const summaries = {
	portfolioConfigMissing: 'Portfolio Config is not configured.',
	projectMissing: 'Delivery Project is missing.',
	modelMissing: 'Selected Delivery execution Model is missing.',
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

async function deliveryConfigFactsWithProject(
	tx: CoreStorageTransaction,
	project: Project | FailedDeliveryPreflight,
): Promise<PreflightStep<DeliveryConfigFacts>> {
	if (isFailedDeliveryPreflight(project)) return ok(project)

	const portfolioConfig = await deliveryPortfolioConfig(tx)
	if (!portfolioConfig.ok) return portfolioConfig

	return isFailedDeliveryPreflight(portfolioConfig.value)
		? ok(portfolioConfig.value)
		: ok({ project, portfolioConfig: portfolioConfig.value })
}

async function deliveryProject(tx: CoreStorageTransaction, delivery: Delivery): Promise<PreflightStep<Project>> {
	const project = await getRequired('project', tx.projects, delivery.projectId, projectPipe)
	return project.ok ? ok(project.value) : mapMissingProject(project.error)
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
	if (!model.ok) return mapMissingModel(model.error)

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
		? ok(failedPreflight(summaries.workConfigUnresolved, { type: 'work-config-unresolved' }))
		: ok({ type: 'passed', modelId, workConfig })
}

function mapMissingProject(error: ResourceNotFoundError | DeliveryPreflightError): PreflightStep<Project> {
	return error.type === 'not-found' ? ok(projectMissing(error)) : { ok: false, error }
}

function mapMissingPortfolioConfig(error: SingletonNotFoundError | DeliveryPreflightError): PreflightStep<PortfolioConfigRecord> {
	return error.type === 'not-found-singleton' ? ok(portfolioConfigMissing(error)) : { ok: false, error }
}

function mapMissingModel(error: ResourceNotFoundError | DeliveryPreflightError): PreflightStep<Model> {
	return error.type === 'not-found' && error.resource === 'model' ? ok(modelMissing(error)) : { ok: false, error }
}

function isFailedDeliveryPreflight(value: unknown): value is FailedDeliveryPreflight {
	return typeof value === 'object' && value !== null && 'type' in value && value.type === 'failed'
}

function portfolioConfigMissing(error: SingletonNotFoundError): FailedDeliveryPreflight {
	return failedPreflight(summaries.portfolioConfigMissing, { type: 'portfolio-config-missing', error })
}

function projectMissing(error: ResourceNotFoundError): FailedDeliveryPreflight {
	return failedPreflight(summaries.projectMissing, { type: 'project-missing', error })
}

function modelMissing(error: ResourceNotFoundError): FailedDeliveryPreflight {
	return failedPreflight(summaries.modelMissing, { type: 'model-missing', error })
}

function modelArchived(modelId: Id): FailedDeliveryPreflight {
	return failedPreflight(summaries.modelArchived, { type: 'model-archived', error: { type: 'archived-model-reference', modelId } })
}

function modelProviderArchived(modelProviderId: Id): FailedDeliveryPreflight {
	return failedPreflight(summaries.modelProviderArchived, {
		type: 'model-provider-archived',
		error: { type: 'archived-model-provider-reference', modelProviderId },
	})
}

function failedPreflight(summary: string, reason: FailedDeliveryPreflightReason): FailedDeliveryPreflight {
	return { type: 'failed', summary, reason }
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
