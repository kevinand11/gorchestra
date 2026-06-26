import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, freeFormStringPipe, idPipe, nonEmptyTrimmedStringPipe, type Id } from './commons'
import {
	deliveryConfigRecordPipe,
	type DeliveryConfig,
	type DeliveryConfigRecord,
	type DeliveryWorkConfig,
	type DeliveryWorkConfigResolution,
} from './config'
import { repositoryPipe } from './repository'
import { slicePipe } from './slice'

/**
 * Derived in priority order: closed, unqueued, dependency-blocked,
 * preflight-failed, needs-artifact-creation, slices-incomplete,
 * delivery-operation-failed, delivery-validation-failed, delivery-review-failed,
 * needs-artifact-validation, needs-review-surface, awaiting-review, then
 * ready-to-ship.
 */
export type DeliveryWorkState =
	| { type: 'closed'; outcome: DeliveryClosedOutcome }
	| { type: 'unqueued' }
	/** blockedBy contains direct unmet Delivery dependencies only, ordered by dependency accepted time then delivery id. */
	| { type: 'dependency-blocked'; blockedBy: Id[] }
	| { type: 'preflight-failed'; actionId: Id }
	/** Delivery is queued and unblocked, but its Delivery Artifact has not been created yet. */
	| { type: 'needs-artifact-creation' }
	/** At least one Slice is not complete; detailed per-Slice state comes from SliceWorkState. */
	| { type: 'slices-incomplete' }
	/** Latest Delivery-scoped external operation failed; explicit manual retry/recovery operation will be added later. */
	| { type: 'delivery-operation-failed'; actionId: Id }
	/** Latest Delivery-level artifact validation failed; Delivery-level correction behavior is deferred. */
	| { type: 'delivery-validation-failed'; actionId: Id }
	/** Current Delivery Review Surface closed without merge; exact Delivery-level correction behavior is deferred. */
	| { type: 'delivery-review-failed'; reviewSurfaceId: Id }
	/** All Slices are complete; Delivery Artifact needs Delivery-level validation before review/ship flow can continue. */
	| { type: 'needs-artifact-validation' }
	/** Delivery Artifact validation passed and Delivery Review Surface still needs to be created. */
	| { type: 'needs-review-surface'; deliveryArtifactId: Id }
	/** Delivery Review Surface exists and is waiting for external review, merge, or observation. */
	| { type: 'awaiting-review'; reviewSurfaceId: Id }
	/** Delivery Branch is integrated into the Target Branch; Delivery can be shipped by shipDelivery. */
	| { type: 'ready-to-ship'; integration: DeliveryIntegration }

export const deliveryIntegrationPipe = v.discriminate((value) => value.type, {
	'review-surface-merged': v.object({ type: v.eq('review-surface-merged'), reviewSurfaceId: idPipe }),
	'observed-artifact-integration': v.object({ type: v.eq('observed-artifact-integration'), actionId: idPipe }),
})
export type DeliveryIntegration = PipeOutput<typeof deliveryIntegrationPipe>

export const deliveryClosedPipe = v.discriminate((value) => value.type, {
	shipped: v.object({ type: v.eq('shipped'), shipped: auditStampPipe, integration: deliveryIntegrationPipe }),
	abandoned: v.object({ type: v.eq('abandoned'), abandoned: auditStampPipe, reason: freeFormStringPipe }),
})
export type DeliveryClosed = PipeOutput<typeof deliveryClosedPipe>
export type DeliveryClosedOutcome = DeliveryClosed['type']

export const deliveryTargetPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.eq('source-control'), repositoryId: idPipe, targetBranch: nonEmptyTrimmedStringPipe }),
})
export type DeliveryTarget = PipeOutput<typeof deliveryTargetPipe>
export type SourceControlDeliveryTarget = Extract<DeliveryTarget, { type: 'source-control' }>

export const deliveryPipe = v.object({
	id: idPipe,
	projectId: idPipe,
	planId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	target: deliveryTargetPipe,
	config: v.nullable(deliveryConfigRecordPipe),
	accepted: auditStampPipe,
	queued: v.nullable(auditStampPipe),
	closed: v.nullable(deliveryClosedPipe),
})
export type Delivery = PipeOutput<typeof deliveryPipe>

export const sourceControlDeliveryReadTargetPipe = v.object({
	type: v.eq('source-control'),
	repository: repositoryPipe,
	targetBranch: nonEmptyTrimmedStringPipe,
})
export type SourceControlDeliveryReadTarget = PipeOutput<typeof sourceControlDeliveryReadTargetPipe>

export const deliveryReadTargetPipe = v.discriminate((value) => value.type, {
	'source-control': sourceControlDeliveryReadTargetPipe,
})
export type DeliveryReadTarget = PipeOutput<typeof deliveryReadTargetPipe>

export const deliveryReadModelPipe = v.object({
	id: idPipe,
	projectId: idPipe,
	planId: idPipe,
	title: nonEmptyTrimmedStringPipe,
	target: deliveryReadTargetPipe,
	config: v.nullable(deliveryConfigRecordPipe),
	accepted: auditStampPipe,
	queued: v.nullable(auditStampPipe),
	closed: v.nullable(deliveryClosedPipe),
	slices: v.array(slicePipe),
})
export type DeliveryReadModel = PipeOutput<typeof deliveryReadModelPipe>

export type { DeliveryConfig, DeliveryConfigRecord, DeliveryWorkConfig, DeliveryWorkConfigResolution }
