import { validateActiveSecret } from './command-storage'
import type { DeliveryPreflightError, DeliveryPreflightSnapshot, PassedDeliveryPreflight } from './delivery-context/work-resolution'
import { resolveDeliveryWork, type DeliveryWorkResolution } from './delivery-context/work-resolution'
import type { Result } from './types'
import type { Id } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import type { Model } from '../domain/model'
import type { ModelProvider, ModelProviderHeader } from '../domain/model-provider'
import type { Repository } from '../domain/repository'
import type { ResourceNotFoundError, SecretNotActiveError, StorageOperationFailedError, InvalidCoreServiceOutputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import type { DeliveryContext } from './delivery-context'

export type {
	DeliveryPreflight,
	DeliveryPreflightError,
	DeliveryPreflightSnapshot,
	FailedDeliveryPreflight,
	FailedDeliveryPreflightReason,
	PassedDeliveryPreflight,
} from './delivery-context/work-resolution'

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

export async function readProviderBackedDeliveryPreflightPlan(
	tx: CoreStorageTransaction,
	context: DeliveryContext,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const localPreflight = await resolveDeliveryWork(tx, context)
	if (!localPreflight.ok) return localPreflight

	return localPreflight.value.type === 'failed'
		? ok({ type: 'local-failed', checks: localPreflight.value.checks, snapshot: localPreflight.value.snapshot })
		: readProviderBackedPlanAfterLocalPreflight(tx, context, localPreflight.value)
}

async function readProviderBackedPlanAfterLocalPreflight(
	tx: CoreStorageTransaction,
	context: DeliveryContext,
	localPreflight: PassedDeliveryPreflight,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const repository = await readRepositoryPlan(tx, context.repository)
	if (!repository.ok) return repository

	const model = await readModelPlan(tx, localPreflight.resolution)
	return model.ok ? ok(providerBackedPlan(context, localPreflight, repository.value, model.value)) : model
}

function providerBackedPlan(
	context: DeliveryContext,
	resolution: PassedDeliveryPreflight,
	repository: RepositoryDeliveryPreflightPlan,
	model: ModelDeliveryPreflightPlan,
): ProviderBackedDeliveryPreflightPlan {
	return {
		type: 'provider-plan',
		repositoryId: context.repository.id,
		resolution,
		repository,
		model,
		snapshot: deliveryPreflightSnapshot({
			type: 'provider-plan',
			repository: context.repository,
			resolution,
			repositoryPlan: repository,
			modelPlan: model,
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
	context: DeliveryContext,
	plan: ProviderBackedDeliveryPreflightPlan,
): Promise<Result<boolean, DeliveryPreflightError>> {
	const current = await readProviderBackedDeliveryPreflightPlan(tx, context)
	return current.ok ? ok(current.value.snapshot === plan.snapshot) : current
}

export function providerBackedDeliveryWorkResolution(plan: ProviderBackedDeliveryPreflightPlan): DeliveryWorkResolution | undefined {
	return plan.type === 'provider-plan' ? plan.resolution.resolution : undefined
}

async function readRepositoryPlan(
	tx: CoreStorageTransaction,
	repository: Repository,
): Promise<Result<RepositoryDeliveryPreflightPlan, DeliveryPreflightError>> {
	const secret = await validateActiveSecret(tx, repository.config.secretId)
	if (!secret.ok) return mapRepositoryAccessSecretFailure(secret.error)

	return ok({ type: 'provider', repository })
}

async function readModelPlan(
	tx: CoreStorageTransaction,
	resolution: DeliveryWorkResolution,
): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	const authSecret = await readModelProviderAuthSecretCheck(tx, resolution.executionModelProvider)
	if (!authSecret.ok) return authSecret
	if (authSecret.value !== null) return ok({ type: 'check', check: authSecret.value })

	return readModelProviderHeaderSecretPlan(tx, resolution.executionModel, resolution.executionModelProvider)
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

function validationEvidence(operation: ValidationEvidence['operation']['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
}

function deliveryPreflightSnapshot(value: unknown): DeliveryPreflightSnapshot {
	return JSON.stringify(value)
}

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}
