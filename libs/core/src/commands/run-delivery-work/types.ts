import type { Id } from '../../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	NotImplementedError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import type { DeliveryWorkResolution, DeliveryContext } from '../../utils/delivery-context'
import type { Result as CoreResult } from '../../utils/types'

export interface Result {
	processedCount: number
	failures: RunDeliveryWorkFailure[]
}

export interface RunDeliveryWorkFailure {
	scope: { type: 'delivery' } | { type: 'slice'; sliceId: Id }
	operation: RunDeliveryWorkFailureOperation
	summary: string
}

export type RunDeliveryWorkFailureOperation =
	| 'preflight'
	| 'create-artifact'
	| 'agent-run'
	| 'validate-artifact'
	| 'validate-delivery-artifact'
	| 'review-surface'

export type RunDeliveryWorkNoObservedChangeTarget =
	| { type: 'slice-review-surface'; sliceId: Id; reviewSurfaceId: Id }
	| { type: 'delivery-review-surface'; reviewSurfaceId: Id }

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| SingletonNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
	| NotImplementedError

export interface RunDeliveryWorkContext {
	services: CoreServices
	tx: CoreStorageTransaction
}

export interface DeliveryHandlerContext extends RunDeliveryWorkContext {
	deliveryContext: DeliveryContext
}

export interface ResolvedDeliveryHandlerContext extends DeliveryHandlerContext {
	workResolution: DeliveryWorkResolution
}

export type { DeliveryWorkResolution }

export type RunDeliveryWorkHandlerResult = CoreResult<Result, Exclude<Error, InvalidInputError>>

export type RunDeliveryWorkStorageError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| SingletonNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
