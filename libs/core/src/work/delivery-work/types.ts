import type { Id } from '../../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	NotImplementedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreServices, CoreStorage, ResolvableSecretValue } from '../../services'
import type { DeliveryWorkResolution, DeliveryContext } from '../../utils/delivery-context'
import type { CoreRuntimeValues } from '../../utils/runtime-values'
import type { Result as CoreResult } from '../../utils/types'

export interface Result {
	processedCount: number
	failures: DeliveryWorkFailure[]
}

export interface DeliveryWorkFailure {
	scope: { type: 'delivery' } | { type: 'slice'; sliceId: Id }
	operation: DeliveryWorkFailureOperation
	summary: string
}

export type DeliveryWorkFailureOperation =
	| 'preflight'
	| 'create-artifact'
	| 'agent-run'
	| 'validate-artifact'
	| 'validate-delivery-artifact'
	| 'review-surface'

export type DeliveryWorkNoObservedChangeTarget =
	| { type: 'slice-review-surface'; sliceId: Id; reviewSurfaceId: Id }
	| { type: 'delivery-review-surface'; reviewSurfaceId: Id }

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
	| NotImplementedError

export interface DeliveryWorkContext {
	services: CoreServices
	storage: CoreStorage
	values: CoreRuntimeValues
	tx?: unknown
}

export interface DeliveryHandlerContext extends DeliveryWorkContext {
	deliveryContext: DeliveryContext
	dispatchStartedActionId?: Id
}

export interface ResolvedDeliveryHandlerContext extends DeliveryHandlerContext {
	workResolution: DeliveryWorkResolution
	repositoryAccessSecret: ResolvableSecretValue
}

export type { DeliveryWorkResolution }

export type DeliveryWorkHandlerResult = CoreResult<Result, Exclude<Error, InvalidInputError>>

export type DeliveryWorkStorageError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
