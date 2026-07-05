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
	failures: ScheduleDeliveryWorkFailure[]
}

export interface ScheduleDeliveryWorkFailure {
	scope: { type: 'delivery' } | { type: 'slice'; sliceId: Id }
	operation: ScheduleDeliveryWorkFailureOperation
	summary: string
}

export type ScheduleDeliveryWorkFailureOperation =
	| 'preflight'
	| 'create-artifact'
	| 'agent-run'
	| 'validate-artifact'
	| 'validate-delivery-artifact'
	| 'review-surface'

export type ScheduleDeliveryWorkNoObservedChangeTarget =
	| { type: 'slice-review-surface'; sliceId: Id; reviewSurfaceId: Id }
	| { type: 'delivery-review-surface'; reviewSurfaceId: Id }

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
	| NotImplementedError

export interface ScheduleDeliveryWorkContext {
	services: CoreServices
	storage: CoreStorage
	values: CoreRuntimeValues
	tx?: unknown
}

export interface DeliveryHandlerContext extends ScheduleDeliveryWorkContext {
	deliveryContext: DeliveryContext
}

export interface ResolvedDeliveryHandlerContext extends DeliveryHandlerContext {
	workResolution: DeliveryWorkResolution
	repositoryAccessSecret: ResolvableSecretValue
}

export type { DeliveryWorkResolution }

export type ScheduleDeliveryWorkHandlerResult = CoreResult<Result, Exclude<Error, InvalidInputError>>

export type ScheduleDeliveryWorkStorageError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError
