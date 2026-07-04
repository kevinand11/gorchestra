import type { DeliveryContext } from './types'
import type { AgentRunProfile } from '../../domain/agent-run-profile'
import type { Id } from '../../domain/commons'
import type { DeliveryWorkConfig, ModelUseConfig } from '../../domain/config'
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
	executionProfile: AgentRunProfile
	executionModelUse: ModelUseConfig
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
	| { type: 'agent-run-profile-archived'; agentRunProfileId: Id }
	| { type: 'model-archived'; modelId: Id }
	| { type: 'model-provider-archived'; modelProviderId: Id }

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
	agentRunProfileArchived: 'Selected Delivery execution Agent Run Profile is archived.',
	modelArchived: 'Selected Delivery execution Model is archived.',
	modelProviderArchived: 'Selected Delivery execution Model Provider is archived.',
} as const

export async function resolveDeliveryWork(
	storage: CoreStorage,
	context: DeliveryContext,
): Promise<Result<DeliveryPreflight, DeliveryPreflightError>> {
	const workConfig = resolveDeliveryWorkConfig(context)
	const executionProfile = await selectedAgentRunProfile(storage, workConfig.executionAgentRunProfileId)
	if (!executionProfile.ok) return executionProfile
	if (isFailedDeliveryPreflight(executionProfile.value)) return ok(executionProfile.value)

	const modelFacts = await selectedModelFacts(storage, executionProfile.value.modelUse)
	if (!modelFacts.ok) return modelFacts
	if (isFailedDeliveryPreflight(modelFacts.value)) return ok(modelFacts.value)

	return ok(
		passedPreflight({
			workConfig,
			executionProfile: executionProfile.value,
			executionModelUse: executionProfile.value.modelUse,
			executionModel: modelFacts.value.model,
			executionModelProvider: modelFacts.value.modelProvider,
		}),
	)
}

type SelectedModelFacts = { model: Model; modelProvider: ModelProvider }

async function selectedAgentRunProfile(storage: CoreStorage, agentRunProfileId: Id): Promise<PreflightStep<AgentRunProfile>> {
	const profile = await getRequired('agent-run-profile', storage, agentRunProfileId)
	if (!profile.ok) return profile

	return isArchived(profile.value) ? ok(agentRunProfileArchived(agentRunProfileId)) : ok(profile.value)
}

async function selectedModelFacts(storage: CoreStorage, modelUse: ModelUseConfig): Promise<PreflightStep<SelectedModelFacts>> {
	const model = await selectedModel(storage, modelUse.modelId)
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

function passedPreflight(resolution: DeliveryWorkResolution): PassedDeliveryPreflight {
	return {
		type: 'passed',
		resolution,
		checks: [deliveryPreflightEvidence(true, 'Delivery preflight passed.')],
		snapshot: deliveryPreflightSnapshot({ type: 'passed', resolution }),
	}
}

type PreflightStep<T> = Result<T | FailedDeliveryPreflight, DeliveryPreflightError>

function agentRunProfileArchived(agentRunProfileId: Id): FailedDeliveryPreflight {
	return failedPreflight(summaries.agentRunProfileArchived, { type: 'agent-run-profile-archived', agentRunProfileId })
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

function resolveDeliveryWorkConfig(context: DeliveryContext): DeliveryWorkConfig {
	return context.delivery.config?.value?.work ?? context.project.config.value.work
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

function isArchived(record: { archivePeriods: Array<{ unarchived: object | null }> }): boolean {
	return record.archivePeriods.at(-1)?.unarchived === null
}

function isFailedDeliveryPreflight(value: unknown): value is FailedDeliveryPreflight {
	return typeof value === 'object' && value !== null && 'type' in value && value.type === 'failed'
}

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}
