import type { Action, ActionResult } from '../../../domain/action'
import type { Delivery } from '../../../domain/delivery'
import type { Link } from '../../../domain/link'
import type { ReviewSurface, ReviewSurfaceReplaced } from '../../../domain/review-surface'
import type { Slice } from '../../../domain/slice'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../../errors'
import type { Result } from '../../types'

export type WorkStateDerivationError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError

export type WorkStateResult<T> = Result<T, WorkStateDerivationError>
export type MaybeStateResult<T> = WorkStateResult<T | null>
export type MaybeStateStep<T> = () => MaybeStateResult<T> | Promise<MaybeStateResult<T>>

export type ActionOfType<TType extends ActionResult['type']> = Action & { result: Extract<ActionResult, { type: TType }> }
export type SliceDeliveryValidationAction = ActionOfType<'validate-slice-delivery-artifact'>
export type DeliveryDependencyLink = Link & {
	def: Extract<Link['def'], { type: 'depends-on'; from: { type: 'delivery' }; to: { type: 'delivery' } }>
}
export type SliceDependencyLink = Link & {
	def: Extract<Link['def'], { type: 'depends-on'; from: { type: 'slice' }; to: { type: 'slice' } }>
}
export type ReplacedReviewSurface = ReviewSurface & { closed: ReviewSurfaceReplaced }
export type DependencyNode = Delivery | Slice
