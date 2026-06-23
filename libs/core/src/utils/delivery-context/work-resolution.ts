import type { DeliveryContext } from './types'
import type { Id } from '../../domain/commons'
import type { DeliveryWorkConfig, ProjectConfigRecord } from '../../domain/config'
import type { ValidationEvidence } from '../../domain/evidence'
import type { Model } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreStorage } from '../../services'
import { getRequired } from '../../storage/helpers'
import type { Result } from '../types'

export interface DeliveryWorkResolution {
	workConfig: DeliveryWorkConfig
	executionModel: Model
	executionModelProvider: ModelProvider
}

export interface PassedDeliveryPreflight {
	type: 'passed'
	resolution: DeliveryWorkResolution
	checks: ValidationEvidence[]
	snapshot: DeliveryPreflightSnapshot
}

export type FailedDeliveryPreflightReason =
	| { type: 'portfolio-config-missing' }
	| { type: 'model-archived'; modelId: Id }
	| { type: 'model-provider-archived'; modelProviderId: Id }
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

const summaries = {
	portfolioConfigMissing: 'Portfolio Config is not configured.',
	modelArchived: 'Selected Delivery execution Model is archived.',
	modelProviderArchived: 'Selected Delivery execution Model Provider is archived.',
	workConfigUnresolved: 'Delivery Work Config is not resolved.',
} as const

export async function resolveDeliveryWork(
	storage: CoreStorage,
	context: DeliveryContext,
): Promise<Result<DeliveryPreflight, DeliveryPreflightError>> {
	if (context.portfolioConfig === null) return ok(portfolioConfigMissing())

	const modelFacts = await selectedModelFacts(storage, resolveExecutionModelId(context))
	if (!modelFacts.ok) return modelFacts
	if (isFailedDeliveryPreflight(modelFacts.value)) return ok(modelFacts.value)

	return resolvedWorkConfig(context, modelFacts.value.model, modelFacts.value.modelProvider)
}

type SelectedModelFacts = { model: Model; modelProvider: ModelProvider }

async function selectedModelFacts(storage: CoreStorage, modelId: Id): Promise<PreflightStep<SelectedModelFacts>> {
	const model = await selectedModel(storage, modelId)
	return model.ok ? selectedModelFactsAfterModel(storage, model.value) : model
}

function selectedModelFactsAfterModel(
	storage: CoreStorage,
	model: Model | FailedDeliveryPreflight,
): Promise<PreflightStep<SelectedModelFacts>> | Result<FailedDeliveryPreflight, never> {
	return isFailedDeliveryPreflight(model) ? ok(model) : selectedModelProviderFacts(storage, model)
}

async function selectedModelProviderFacts(storage: CoreStorage, model: Model): Promise<PreflightStep<SelectedModelFacts>> {
	const modelProvider = await selectedModelProvider(storage, model.providerId)
	return modelProvider.ok ? selectedModelFactsAfterProvider(model, modelProvider.value) : modelProvider
}

function selectedModelFactsAfterProvider(
	model: Model,
	modelProvider: ModelProvider | FailedDeliveryPreflight,
): Result<SelectedModelFacts | FailedDeliveryPreflight, never> {
	return isFailedDeliveryPreflight(modelProvider) ? ok(modelProvider) : ok({ model, modelProvider })
}

async function selectedModel(storage: CoreStorage, modelId: Id): Promise<PreflightStep<Model>> {
	const model = await getRequired('model', storage, modelId)
	if (!model.ok) return model

	return isArchived(model.value) ? ok(modelArchived(modelId)) : ok(model.value)
}

async function selectedModelProvider(storage: CoreStorage, providerId: Id): Promise<PreflightStep<ModelProvider>> {
	const provider = await getRequired('model-provider', storage, providerId)
	if (!provider.ok) return provider

	return isArchived(provider.value) ? ok(modelProviderArchived(provider.value.id)) : ok(provider.value)
}

function resolvedWorkConfig(
	context: DeliveryContext,
	executionModel: Model,
	executionModelProvider: ModelProvider,
): Result<DeliveryPreflight, never> {
	const workConfig = resolveDeliveryWorkConfig(context)
	return workConfig === null
		? ok(
				failedPreflight(
					summaries.workConfigUnresolved,
					{ type: 'work-config-unresolved' },
					unresolvedWorkConfigSnapshot(context, executionModel, executionModelProvider),
				),
			)
		: ok(passedPreflight({ workConfig, executionModel, executionModelProvider }))
}

function passedPreflight(resolution: DeliveryWorkResolution): PassedDeliveryPreflight {
	return {
		type: 'passed',
		resolution,
		checks: [deliveryPreflightEvidence(true, 'Delivery preflight passed.')],
		snapshot: deliveryPreflightSnapshot({ type: 'passed', resolution }),
	}
}

type PreflightStep<T> = Result<T | FailedDeliveryPreflight, DeliveryPreflightError>

function portfolioConfigMissing(): FailedDeliveryPreflight {
	return failedPreflight(summaries.portfolioConfigMissing, { type: 'portfolio-config-missing' })
}

function modelArchived(modelId: Id): FailedDeliveryPreflight {
	return failedPreflight(summaries.modelArchived, { type: 'model-archived', modelId })
}

function modelProviderArchived(modelProviderId: Id): FailedDeliveryPreflight {
	return failedPreflight(summaries.modelProviderArchived, { type: 'model-provider-archived', modelProviderId })
}

function failedPreflight(summary: string, reason: FailedDeliveryPreflightReason, snapshotInput: unknown = reason): FailedDeliveryPreflight {
	return {
		type: 'failed',
		checks: [deliveryPreflightEvidence(false, summary)],
		reason,
		snapshot: deliveryPreflightSnapshot(snapshotInput),
	}
}

function resolveExecutionModelId(context: DeliveryContext): Id {
	if (context.portfolioConfig === null) throw new Error('Expected Portfolio Config before resolving execution Model.')

	return firstPresent([
		context.delivery.config?.value?.model?.executionModelId,
		context.projectConfig?.value?.model?.executionModelId,
		context.portfolioConfig.value.model.executionModelId,
		context.portfolioConfig.value.model.defaultModelId,
	])
}

function resolveDeliveryWorkConfig(context: DeliveryContext): DeliveryWorkConfig | null {
	if (context.portfolioConfig === null) return null

	return firstOptional([context.delivery.config?.value?.work, context.projectConfig?.value?.work, context.portfolioConfig.value.work])
}

function unresolvedWorkConfigSnapshot(context: DeliveryContext, executionModel: Model, executionModelProvider: ModelProvider) {
	return {
		type: 'work-config-unresolved',
		executionModel,
		executionModelProvider,
		deliveryWorkConfig: deliveryWorkConfigValue(context.delivery),
		projectWorkConfig: projectWorkConfigValue(context.projectConfig),
		portfolioWorkConfig: context.portfolioConfig?.value.work ?? null,
	}
}

function deliveryWorkConfigValue(delivery: DeliveryContext['delivery']): DeliveryWorkConfig | null {
	return delivery.config === null ? null : (delivery.config.value?.work ?? null)
}

function projectWorkConfigValue(projectConfig: ProjectConfigRecord | null): DeliveryWorkConfig | null {
	return projectConfig === null ? null : (projectConfig.value?.work ?? null)
}

function deliveryPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return validationEvidence('delivery-preflight', passed, summary)
}

function validationEvidence(operation: ValidationEvidence['operation']['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
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

function isFailedDeliveryPreflight(value: unknown): value is FailedDeliveryPreflight {
	return typeof value === 'object' && value !== null && 'type' in value && value.type === 'failed'
}

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}
