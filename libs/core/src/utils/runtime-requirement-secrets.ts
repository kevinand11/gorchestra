import type { Result } from './types'
import type { AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import type { Id } from '../domain/commons'
import type {
	ArchivedSecretReferenceError,
	InvalidCoreServiceOutputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import { getRecord, notFound } from '../storage/helpers'

export type RuntimeRequirementSecretReferenceError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ArchivedSecretReferenceError

export async function validateRuntimeRequirementSecretReferences(
	storage: CoreStorage,
	requirements: AgentRunRuntimeRequirement[],
): Promise<Result<void, RuntimeRequirementSecretReferenceError>> {
	for (const secretId of secretIdsFromRuntimeRequirements(requirements)) {
		const validation = await validateActiveSecretReference(storage, secretId)
		if (!validation.ok) return validation
	}

	return { ok: true, value: undefined }
}

export function secretIdsFromRuntimeRequirements(requirements: AgentRunRuntimeRequirement[]): Id[] {
	return uniqueIds(requirements.flatMap(secretIdsFromRuntimeRequirement))
}

function secretIdsFromRuntimeRequirement(requirement: AgentRunRuntimeRequirement): Id[] {
	switch (requirement.type) {
		case 'environment-secret':
			return [requirement.secretId]
		case 'run-command':
			return Object.values(requirement.commandSecretEnv)
		default:
			throw new Error(`Unexpected Agent Run Runtime Requirement type: ${String(requirement satisfies never)}`)
	}
}

async function validateActiveSecretReference(
	storage: CoreStorage,
	secretId: Id,
): Promise<Result<void, RuntimeRequirementSecretReferenceError>> {
	const secret = await getRecord('secret', storage, secretId)
	if (!secret.ok) return secret
	if (secret.value === null) return notFound('secret', secretId)

	return secret.value.archivePeriods.at(-1)?.unarchived === null
		? { ok: false, error: { type: 'archived-secret-reference', secretId } }
		: { ok: true, value: undefined }
}

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
}
