import type { AgentRunRuntimeRequirement } from '../domain/agent-run-runtime'
import type { Id } from '../domain/commons'
import type { InvalidCoreServiceOutputError, ResourceNotFoundError, ResourceArchivedError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import { validateActiveSecretReferences } from './secrets'
import type { Result } from './types'

export type RuntimeRequirementSecretReferenceError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export function validateRuntimeRequirementSecretReferences(
	storage: CoreStorage,
	requirements: AgentRunRuntimeRequirement[],
): Promise<Result<void, RuntimeRequirementSecretReferenceError>> {
	return validateActiveSecretReferences(storage, secretIdsFromRuntimeRequirements(requirements))
}

function secretIdsFromRuntimeRequirements(requirements: AgentRunRuntimeRequirement[]): Id[] {
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

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
}
