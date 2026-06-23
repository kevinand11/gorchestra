import type {
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../../errors'

export type ConfigCommandReferenceError = ResourceNotFoundError | ArchivedModelReferenceError | ArchivedModelProviderReferenceError
export type ConfigCommandStorageError = StorageOperationFailedError | InvalidCoreServiceOutputError | InvariantViolationError
export type RepositoryCommandReferenceError = ResourceNotFoundError | SecretNotActiveError | ProjectSourceTypeMismatchError
export type DeliveryActionCommandError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError
