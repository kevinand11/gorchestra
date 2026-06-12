import type {
	ModelProviderResolvedAccess,
	RuntimeDeliveryWorkContext,
	RuntimeDeliveryWorkContextUpgrade,
	StoredDeliveryContext,
} from './types'
import type { Id } from '../../domain/commons'
import type { ValidationEvidence } from '../../domain/evidence'
import { modelPipe, type Model } from '../../domain/model'
import { modelProviderPipe, type ModelProvider, type ModelProviderHeader } from '../../domain/model-provider'
import type { InvalidCoreServiceOutputError, ResourceNotFoundError, SecretNotActiveError, StorageOperationFailedError } from '../../errors'
import { resolvedSecretValuesPipe, type CoreServices, type CoreStorageTransaction, type ResolvedSecretValues } from '../../services'
import { validateCoreServiceOutput } from '../../validation'
import { validateActiveSecret } from '../command-storage'
import {
	preflightDeliveryWork,
	type DeliveryPreflight,
	type DeliveryPreflightError,
	type DeliveryPreflightSnapshot,
	type PassedDeliveryPreflight,
} from '../delivery-preflight'
import { getRequired } from '../storage'
import type { Result } from '../types'

export type RuntimeDeliveryWorkContextError = DeliveryPreflightError

export async function upgradeToRuntimeDeliveryWorkContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: StoredDeliveryContext,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	const localPreflight = await preflightDeliveryWork(tx, stored.delivery)
	return localPreflight.ok ? runtimeContextUpgradeForPreflight(services, tx, stored, localPreflight.value) : localPreflight
}

async function runtimeContextUpgradeForPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: StoredDeliveryContext,
	preflight: DeliveryPreflight,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	return preflight.type === 'failed'
		? failedRuntimeContextUpgrade(preflight.checks, preflight.snapshot)
		: runtimeContextUpgradeForPassedPreflight(services, tx, stored, preflight)
}

async function runtimeContextUpgradeForPassedPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	stored: StoredDeliveryContext,
	preflight: PassedDeliveryPreflight,
): Promise<Result<RuntimeDeliveryWorkContextUpgrade, RuntimeDeliveryWorkContextError>> {
	const modelFacts = await runtimeModelFacts(tx, preflight.modelId)
	if (!modelFacts.ok) return modelFacts

	const access = await runtimeProviderAccess(services, tx, stored.repository.config.secretId, modelFacts.value.modelProvider)
	return access.ok ? runtimeContextUpgradeWithAccess(stored, preflight, modelFacts.value, access.value) : access
}

function runtimeContextUpgradeWithAccess(
	stored: StoredDeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: RuntimeProviderAccess,
): Result<RuntimeDeliveryWorkContextUpgrade, never> {
	return access.type === 'failed-preflight'
		? { ok: true, value: access }
		: okRuntimeDeliveryWorkContext(stored, preflight, modelFacts, access)
}

function okRuntimeDeliveryWorkContext(
	stored: StoredDeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: Extract<RuntimeProviderAccess, { type: 'resolved' }>,
): Result<RuntimeDeliveryWorkContextUpgrade, never> {
	return {
		ok: true,
		value: {
			type: 'runtime-context',
			context: runtimeDeliveryWorkContext(stored, preflight, modelFacts, access),
			snapshot: preflight.checks.map((check) => check.summary).join('|'),
		},
	}
}

function runtimeDeliveryWorkContext(
	stored: StoredDeliveryContext,
	preflight: PassedDeliveryPreflight,
	modelFacts: { model: Model; modelProvider: ModelProvider },
	access: Extract<RuntimeProviderAccess, { type: 'resolved' }>,
): RuntimeDeliveryWorkContext {
	return {
		...stored,
		workConfig: preflight.workConfig,
		executionModel: modelFacts.model,
		executionModelProvider: modelFacts.modelProvider,
		sourceControlAccessToken: { type: 'access-token', plaintext: access.repositoryAccessToken },
		modelProviderAccess: access.modelProviderAccess,
	}
}

function failedRuntimeContextUpgrade(
	checks: ValidationEvidence[],
	snapshot: DeliveryPreflightSnapshot,
): Result<Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>, never> {
	return { ok: true, value: { type: 'failed-preflight', checks, snapshot } }
}

async function runtimeModelFacts(
	tx: CoreStorageTransaction,
	modelId: Id,
): Promise<Result<{ model: Model; modelProvider: ModelProvider }, RuntimeDeliveryWorkContextError>> {
	const model = await getRequired('model', tx.models, modelId, modelPipe)
	if (!model.ok) return model

	const modelProvider = await getRequired('model-provider', tx.modelProviders, model.value.providerId, modelProviderPipe)
	return modelProvider.ok ? { ok: true, value: { model: model.value, modelProvider: modelProvider.value } } : modelProvider
}

type RuntimeProviderAccess =
	| { type: 'resolved'; repositoryAccessToken: string; modelProviderAccess: ModelProviderResolvedAccess }
	| Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>

async function runtimeProviderAccess(
	services: CoreServices,
	tx: CoreStorageTransaction,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	const secretIds = providerAccessSecretIds(repositorySecretId, modelProvider)
	const readiness = await runtimeProviderAccessReadiness(tx, secretIds)
	return readiness.ok
		? runtimeProviderAccessAfterReadiness(services, repositorySecretId, modelProvider, secretIds, readiness.value)
		: readiness
}

async function runtimeProviderAccessReadiness(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<
	Result<ValidationEvidence[] | Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>, RuntimeDeliveryWorkContextError>
> {
	const readiness = await providerAccessSecretsReady(tx, secretIds)
	return readiness.ok && readiness.value.length > 0 ? failedRuntimeContextUpgrade(readiness.value, JSON.stringify(secretIds)) : readiness
}

async function runtimeProviderAccessAfterReadiness(
	services: CoreServices,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
	readiness: ValidationEvidence[] | Extract<RuntimeDeliveryWorkContextUpgrade, { type: 'failed-preflight' }>,
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	return Array.isArray(readiness)
		? resolvedRuntimeProviderAccess(services, repositorySecretId, modelProvider, secretIds)
		: { ok: true, value: readiness }
}

async function resolvedRuntimeProviderAccess(
	services: CoreServices,
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
): Promise<Result<RuntimeProviderAccess, RuntimeDeliveryWorkContextError>> {
	const plaintext = await resolveRuntimeSecretValues(services, secretIds)
	return plaintext.ok ? runtimeProviderAccessFromPlaintext(repositorySecretId, modelProvider, secretIds, plaintext.value) : plaintext
}

function runtimeProviderAccessFromPlaintext(
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	secretIds: Id[],
	plaintext: ResolvedSecretValues,
): Result<RuntimeProviderAccess, never> {
	const unresolved = unresolvedProviderAccessChecks(repositorySecretId, modelProvider, plaintext)
	return unresolved.length > 0
		? failedRuntimeContextUpgrade(unresolved, JSON.stringify(secretIds))
		: {
				ok: true,
				value: {
					type: 'resolved',
					repositoryAccessToken: plaintext[repositorySecretId]!,
					modelProviderAccess: modelProviderAccess(modelProvider, plaintext),
				},
			}
}

function providerAccessSecretIds(repositorySecretId: Id, modelProvider: ModelProvider): Id[] {
	return [repositorySecretId, ...modelProviderSecretIds(modelProvider)]
}

function modelProviderSecretIds(modelProvider: ModelProvider): Id[] {
	return [modelProvider.auth?.secretId, ...modelProvider.headers.map((header) => header.valueSecretId)].filter(
		(id): id is Id => id !== undefined,
	)
}

async function providerAccessSecretsReady(
	tx: CoreStorageTransaction,
	secretIds: Id[],
): Promise<Result<ValidationEvidence[], RuntimeDeliveryWorkContextError>> {
	const checks: ValidationEvidence[] = []
	for (const secretId of secretIds) {
		const ready = await validateActiveSecret(tx, secretId)
		if (!ready.ok) {
			const check = secretReadinessCheck(secretId, ready.error)
			if (check === null) return secretReadinessOperationError(ready.error)
			checks.push(check)
		}
	}

	return { ok: true, value: checks }
}

function secretReadinessCheck(
	secretId: Id,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): ValidationEvidence | null {
	if (error.type === 'not-found' && error.resource === 'secret')
		return validationEvidence('delivery-preflight', false, `Secret ${secretId} is missing.`)
	if (error.type === 'secret-not-active') return validationEvidence('delivery-preflight', false, `Secret ${secretId} is not active.`)

	return null
}

function secretReadinessOperationError(
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): Result<never, RuntimeDeliveryWorkContextError> {
	return error.type === 'storage-operation-failed' || error.type === 'invalid-core-service-output'
		? { ok: false, error }
		: { ok: false, error: { type: 'invariant-violation', message: 'Unexpected Secret readiness error.' } }
}

async function resolveRuntimeSecretValues(
	services: CoreServices,
	secretIds: Id[],
): Promise<Result<ResolvedSecretValues, RuntimeDeliveryWorkContextError>> {
	try {
		return validateCoreServiceOutput(
			resolvedSecretValuesPipe,
			await services.secrets.resolveSecretValues({ secretIds }),
			'secrets',
			'resolveSecretValues',
		)
	} catch {
		return { ok: true, value: {} }
	}
}

function unresolvedProviderAccessChecks(
	repositorySecretId: Id,
	modelProvider: ModelProvider,
	plaintext: ResolvedSecretValues,
): ValidationEvidence[] {
	return [
		...missingSecretValueCheck(repositorySecretId, 'Repository access Secret value could not be resolved.'),
		...modelProviderSecretIds(modelProvider).flatMap((secretId) =>
			missingSecretValueCheck(secretId, 'Model Provider Secret value could not be resolved.'),
		),
	]
		.filter((check) => plaintext[check.secretId] === undefined)
		.map((check) => check.evidence)
}

function missingSecretValueCheck(secretId: Id, summary: string): Array<{ secretId: Id; evidence: ValidationEvidence }> {
	return [{ secretId, evidence: validationEvidence('delivery-preflight', false, summary) }]
}

function modelProviderAccess(modelProvider: ModelProvider, plaintext: ResolvedSecretValues): ModelProviderResolvedAccess {
	return {
		auth: modelProvider.auth === null ? null : { type: 'apiKey', plaintext: plaintext[modelProvider.auth.secretId]! },
		headers: modelProvider.headers.map((header) => modelProviderHeaderAccess(header, plaintext)),
	}
}

function modelProviderHeaderAccess(header: ModelProviderHeader, plaintext: ResolvedSecretValues): { name: string; plaintext: string } {
	return { name: header.name, plaintext: plaintext[header.valueSecretId]! }
}

function validationEvidence(operation: ValidationEvidence['operation']['type'], passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: operation }, passed, summary }
}
