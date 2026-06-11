import type { Action, ActionResult } from '../../domain/action'
import type { AgentRun } from '../../domain/agent-run'
import type { DeliveryArtifact, SliceArtifact } from '../../domain/artifact'
import type { Id } from '../../domain/commons'
import type { Delivery } from '../../domain/delivery'
import type { Link } from '../../domain/graph'
import type { ReviewSurface, ReviewSurfaceReplaced } from '../../domain/review-surface'
import type { Slice } from '../../domain/slice'
import type {
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../../errors'
import type { Result } from '../types'

export type WorkStateDerivationError =
	| InvalidCoreServiceOutputError
	| ResourceNotFoundError
	| StorageOperationFailedError
	| InvariantViolationError

export type WorkStateResult<T> = Result<T, WorkStateDerivationError>
export type MaybeStateResult<T> = WorkStateResult<T | null>
export type MaybeStateStep<T> = () => MaybeStateResult<T> | Promise<MaybeStateResult<T>>

export interface WorkStateFacts {
	actions: Action[]
	agentRuns: AgentRun[]
	links: Link[]
	deliveryArtifacts: DeliveryArtifact[]
	sliceArtifacts: SliceArtifact[]
	reviewSurfaces: ReviewSurface[]
	slices: Slice[]
}

export type ActionOfType<TType extends ActionResult['type']> = Action & { result: Extract<ActionResult, { type: TType }> }
export type SliceDeliveryValidationAction = ActionOfType<'validate-slice-delivery-artifact'>
export type DeliveryDependencyLink = Link & { type: 'depends-on'; from: { type: 'delivery'; id: Id }; to: { type: 'delivery'; id: Id } }
export type SliceDependencyLink = Link & { type: 'depends-on'; from: { type: 'slice'; id: Id }; to: { type: 'slice'; id: Id } }
export type ReplacedReviewSurface = ReviewSurface & { closed: ReviewSurfaceReplaced }
export type DependencyNode = Delivery | Slice
