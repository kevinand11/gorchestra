import { validateActiveSecret } from '../commands/utils/storage'
import type { Id } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import type { Model } from '../domain/model'
import type { ModelProvider, ModelProviderHeader } from '../domain/model-provider'
import type { Repository } from '../domain/repository'
import type { InvalidCoreServiceOutputError, ResourceNotFoundError, SecretNotActiveError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage, ResolvableSecretValue } from '../services'
import type { DeliveryContext } from './delivery-context'
import type { DeliveryPreflightError, DeliveryPreflightSnapshot, PassedDeliveryPreflight } from './delivery-context/work-resolution'
import { resolveDeliveryWork, type DeliveryWorkResolution } from './delivery-context/work-resolution'
import type { Result } from './types'

export type {
	DeliveryPreflight,
	DeliveryPreflightError,
	DeliveryPreflightSnapshot,
	FailedDeliveryPreflight,
	FailedDeliveryPreflightReason,
	PassedDeliveryPreflight,
} from './delivery-context/work-resolution'

export type RepositoryDeliveryPreflightPlan =
	| { type: 'check'; check: ValidationEvidence }
	| { type: 'provider'; repository: Repository; accessSecret: ResolvableSecretValue }

export type ModelDeliveryPreflightPlan =
	| { type: 'check'; check: ValidationEvidence }
	| { type: 'provider'; model: Model; modelProvider: ModelProvider; secrets: ResolvableSecretValue[] }

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
	storage: CoreStorage,
	context: DeliveryContext,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const localPreflight = await resolveDeliveryWork(storage, context)
	if (!localPreflight.ok) return localPreflight

	return localPreflight.value.type === 'failed'
		? ok({ type: 'local-failed', checks: localPreflight.value.checks, snapshot: localPreflight.value.snapshot })
		: readProviderBackedPlanAfterLocalPreflight(storage, context, localPreflight.value)
}

async function readProviderBackedPlanAfterLocalPreflight(
	storage: CoreStorage,
	context: DeliveryContext,
	localPreflight: PassedDeliveryPreflight,
): Promise<Result<ProviderBackedDeliveryPreflightPlan, DeliveryPreflightError>> {
	const repository = await readRepositoryPlan(storage, context.repository)
	if (!repository.ok) return repository

	const model = await readModelPlan(storage, localPreflight.resolution)
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
	storage: CoreStorage,
	context: DeliveryContext,
	plan: ProviderBackedDeliveryPreflightPlan,
): Promise<Result<boolean, DeliveryPreflightError>> {
	const current = await readProviderBackedDeliveryPreflightPlan(storage, context)
	return current.ok ? ok(current.value.snapshot === plan.snapshot) : current
}

export function providerBackedDeliveryWorkResolution(plan: ProviderBackedDeliveryPreflightPlan): DeliveryWorkResolution | undefined {
	return plan.type === 'provider-plan' ? plan.resolution.resolution : undefined
}

export function providerBackedRepositoryAccessSecret(plan: ProviderBackedDeliveryPreflightPlan): ResolvableSecretValue | undefined {
	return plan.type === 'provider-plan' && plan.repository.type === 'provider' ? plan.repository.accessSecret : undefined
}

async function readRepositoryPlan(
	storage: CoreStorage,
	repository: Repository,
): Promise<Result<RepositoryDeliveryPreflightPlan, DeliveryPreflightError>> {
	const secret = await validateActiveSecret(storage, repository.config.secretId)
	if (!secret.ok) return mapRepositoryAccessSecretFailure(secret.error)

	return ok({ type: 'provider', repository, accessSecret: secretValueRef(secret.value) })
}

async function readModelPlan(
	storage: CoreStorage,
	resolution: DeliveryWorkResolution,
): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	const authSecret = await readModelProviderAuthSecretCheck(storage, resolution.executionModelProvider)
	return authSecret.ok ? readModelPlanWithAuthSecret(storage, resolution, authSecret.value) : authSecret
}

async function readModelPlanWithAuthSecret(
	storage: CoreStorage,
	resolution: DeliveryWorkResolution,
	authSecret: { type: 'secrets'; secrets: ResolvableSecretValue[] } | { type: 'check'; check: ValidationEvidence },
): Promise<Result<ModelDeliveryPreflightPlan, DeliveryPreflightError>> {
	if (authSecret.type === 'check') return ok(authSecret)

	const headerSecrets = await readModelProviderHeaderSecretPlan(storage, resolution.executionModelProvider)
	return headerSecrets.ok ? modelPlanFromSecrets(resolution, authSecret.secrets, headerSecrets.value) : headerSecrets
}

function modelPlanFromSecrets(
	resolution: DeliveryWorkResolution,
	authSecrets: ResolvableSecretValue[],
	headerSecrets: { type: 'secrets'; secrets: ResolvableSecretValue[] } | { type: 'check'; check: ValidationEvidence },
): Result<ModelDeliveryPreflightPlan, never> {
	return headerSecrets.type === 'check'
		? ok(headerSecrets)
		: ok(providerModelPlan(resolution.executionModel, resolution.executionModelProvider, authSecrets, headerSecrets.secrets))
}

async function readModelProviderAuthSecretCheck(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<
	Result<{ type: 'secrets'; secrets: ResolvableSecretValue[] } | { type: 'check'; check: ValidationEvidence }, DeliveryPreflightError>
> {
	if (modelProvider.auth === null) return ok({ type: 'secrets', secrets: [] })

	const secret = await validateActiveSecret(storage, modelProvider.auth.secretId)
	return secret.ok
		? ok({ type: 'secrets', secrets: [secretValueRef(secret.value)] })
		: mapModelProviderAuthSecretFailure(modelProvider, secret.error)
}

async function readModelProviderHeaderSecretPlan(
	storage: CoreStorage,
	modelProvider: ModelProvider,
): Promise<
	Result<{ type: 'secrets'; secrets: ResolvableSecretValue[] } | { type: 'check'; check: ValidationEvidence }, DeliveryPreflightError>
> {
	const secrets: ResolvableSecretValue[] = []
	for (const header of modelProvider.headers) {
		const secret = await validateActiveSecret(storage, header.valueSecretId)
		if (!secret.ok) return mapModelProviderHeaderSecretFailure(modelProvider, header, secret.error)
		secrets.push(secretValueRef(secret.value))
	}

	return ok({ type: 'secrets', secrets })
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
): Result<{ type: 'check'; check: ValidationEvidence }, DeliveryPreflightError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return ok({
			type: 'check',
			check: validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'auth', 'missing')),
		})
	}
	if (error.type === 'secret-not-active') {
		return ok({
			type: 'check',
			check: validationEvidence('model-preflight', false, modelSecretSummary(modelProvider, 'auth', 'inactive')),
		})
	}

	return { ok: false, error }
}

function mapModelProviderHeaderSecretFailure(
	modelProvider: ModelProvider,
	_header: ModelProviderHeader,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<{ type: 'check'; check: ValidationEvidence }, DeliveryPreflightError> {
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

	const preflight = await runtime.providers.sourceControl.preflightRepository({
		repository: plan.repository,
		accessSecret: plan.accessSecret,
	})
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
		secrets: plan.secrets,
	})
	return preflight.ok ? ok(validationEvidence('model-preflight', preflight.value.type === 'passed', preflight.value.summary)) : preflight
}

function providerModelPlan(
	model: Model,
	modelProvider: ModelProvider,
	authSecrets: ResolvableSecretValue[],
	headerSecrets: ResolvableSecretValue[],
): ModelDeliveryPreflightPlan {
	return { type: 'provider', model, modelProvider, secrets: uniqueSecrets([...authSecrets, ...headerSecrets]) }
}

function uniqueSecrets(secrets: ResolvableSecretValue[]): ResolvableSecretValue[] {
	return [...new Map(secrets.map((secret) => [secret.secretId, secret])).values()]
}

function secretValueRef(secret: { id: string; valueRef: string }): ResolvableSecretValue {
	return { secretId: secret.id, valueRef: secret.valueRef }
}

function modelSecretSummary(modelProvider: ModelProvider, secretKind: 'auth' | 'header', state: 'missing' | 'inactive'): string {
	const providerName = protocolDisplayName(modelProvider)
	const noun = secretKind === 'auth' ? 'auth Secret' : 'header Secret'
	return `${providerName} model provider ${noun} is ${state === 'missing' ? 'missing' : 'not active'}.`
}

function protocolDisplayName(modelProvider: ModelProvider): string {
	switch (modelProvider.protocol.type) {
		case 'anthropic-messages':
			return 'Anthropic Messages'
		case 'openai-responses':
			return 'OpenAI Responses'
		case 'openai-completions':
			return 'OpenAI Completions'
		case 'google-generative-ai':
			return 'Google Generative AI'
		default:
			throw new Error(`Unexpected Model Provider Protocol: ${String(modelProvider.protocol satisfies never)}`)
	}
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
