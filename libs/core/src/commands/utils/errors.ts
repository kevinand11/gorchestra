import type {
	ArchivedAgentRunProfileReferenceError,
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../../errors'

export type ConfigCommandReferenceError =
	| ResourceNotFoundError
	| ArchivedModelReferenceError
	| ArchivedModelProviderReferenceError
	| ArchivedAgentRunProfileReferenceError
	| ModelThinkingLevelUnavailableError
export type ConfigCommandStorageError = StorageOperationFailedError | InvalidCoreServiceOutputError | InvariantViolationError
export type RepositoryCommandReferenceError = ResourceNotFoundError | SecretNotActiveError | ProjectSourceTypeMismatchError
export type DeliveryActionCommandError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError
