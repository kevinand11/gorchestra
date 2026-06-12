import type { Id } from '../../domain/commons'
import type { DeliveryWorkConfig } from '../../domain/config'
import type { Delivery } from '../../domain/delivery'
import type {
	ArchivedModelProviderReferenceError,
	ArchivedModelReferenceError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	NotImplementedError,
	ResourceNotFoundError,
	SingletonNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import type { Result as CoreResult } from '../../utils/types'

export type Result =
	/** At least one of actionIds or agentRunIds must be non-empty. */
	{ type: 'worked'; actionIds: Id[]; agentRunIds: Id[] } | { type: 'no-op'; reason: RunDeliveryWorkNoOpReason }

export type RunDeliveryWorkNoOpReason =
	| { type: 'no-eligible-work' }
	| { type: 'slice-capacity-full'; activeSlots: number; maxProcessableSliceSlots: number }
	| { type: 'claim-conflict'; work: RunDeliveryWorkClaimConflictWork }
	| { type: 'no-observed-change'; observed: RunDeliveryWorkNoObservedChangeTarget }

export type RunDeliveryWorkClaimConflictWork = { type: 'delivery' } | { type: 'slice'; sliceId: Id }

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
	| ArchivedModelReferenceError
	| ArchivedModelProviderReferenceError
	| NotImplementedError

export interface RunDeliveryWorkContext {
	options: CoreServices
	tx: CoreStorageTransaction
}

export interface DeliveryHandlerContext extends RunDeliveryWorkContext {
	delivery: Delivery
	preflight?: DeliveryWorkResolution
}

export interface DeliveryWorkResolution {
	modelId: Id
	workConfig: DeliveryWorkConfig
}

export type RunDeliveryWorkHandlerResult = CoreResult<Result, Exclude<Error, InvalidInputError>>

export type RunDeliveryWorkStorageError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| SingletonNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError

export type RunDeliveryWorkResolutionError = RunDeliveryWorkStorageError | ArchivedModelReferenceError | ArchivedModelProviderReferenceError
