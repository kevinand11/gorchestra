import type {
	DeliveryWorkStateMismatchError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ModelThinkingLevelUnavailableError,
	ProjectSourceTypeMismatchError,
	ResourceArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'

export type ConfigCommandReferenceError = ResourceNotFoundError | ResourceArchivedError | ModelThinkingLevelUnavailableError
export type ConfigCommandStorageError = StorageOperationFailedError | InvalidCoreServiceOutputError | InvariantViolationError
export type RepositoryCommandReferenceError = ResourceNotFoundError | ResourceArchivedError | ProjectSourceTypeMismatchError
export type DeliveryActionCommandError =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| DeliveryWorkStateMismatchError
	| InvariantViolationError
