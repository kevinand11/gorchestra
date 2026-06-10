import type {
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	InvalidCoreServiceOutputError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'

export type ConfigCommandReferenceError = ResourceNotFoundError | ArchivedModelReferenceError | ArchivedModelProviderReferenceError
export type ConfigCommandStorageError = StorageOperationFailedError | InvalidCoreServiceOutputError
export type RepositoryCommandReferenceError = ResourceNotFoundError | SecretNotActiveError | ProjectSourceTypeMismatchError
