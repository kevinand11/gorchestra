import type { PipeOutput } from 'valleyed'

import type { DeliveryWorkOperation } from './action'
import { auditStampPipe, idPipe, nonEmptyTrimmedStringPipe, nonNegativeIntegerPipe, type Id } from './commons'
import { instructionSourcePipe } from './plan'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const sliceSchema = coreSchema('slices')
	.field('deliveryId', idPipe)
	.field('order', nonNegativeIntegerPipe)
	.field('title', nonEmptyTrimmedStringPipe)
	.field('instruction', instructionSourcePipe)
	.field('accepted', auditStampPipe)
	.build()
export const slicePipe = schemaToPipe(sliceSchema)
export type Slice = PipeOutput<typeof slicePipe>

/**
 * Derived in priority order: complete, operation-running, operation-queued,
 * needs-delivery-validation, dependency-blocked, needs-artifact-validation, correction-blocked,
 * needs-review-surface, awaiting-review, slice-operation-failed,
 * needs-artifact-creation, then executable.
 */
export interface FailureChain {
	/** The failed validation or external-operation Action that started the chain. */
	rootActionId: Id

	/** Number of correction Agent Runs started for this chain. */
	correctionRetries: number
}

export type SliceWorkState =
	/** actionId points to the passed validate-slice-delivery-artifact Action that completed the Slice. */
	| { type: 'complete'; actionId: Id }
	| { type: 'operation-running'; operation: DeliveryWorkOperation; startedActionId: Id }
	| { type: 'operation-queued'; operation: DeliveryWorkOperation; queuedActionId: Id }
	/** Slice Artifact was promoted into the Delivery Artifact and the resulting Delivery Artifact still needs validation. */
	| { type: 'needs-delivery-validation'; actionId: Id }
	/** blockedBy contains direct incomplete same-Delivery Slice dependencies only, ordered by dependency accepted time then slice id. */
	| { type: 'dependency-blocked'; blockedBy: Id[] }
	| { type: 'needs-artifact-validation'; mode: 'initial'; sliceArtifactId: Id }
	| {
			type: 'needs-artifact-validation'
			mode: 'correction'
			sliceArtifactId: Id
			failureChain: FailureChain
	  }
	/** actionId points to the latest failed Action that exhausted retries; failureChain.rootActionId points to the first failed Action in the chain. */
	| { type: 'correction-blocked'; actionId: Id; failureChain: FailureChain }
	/** Slice Artifact validation passed and Slice Review Surface still needs to be created. */
	| { type: 'needs-review-surface'; sliceArtifactId: Id }
	| { type: 'awaiting-review'; reviewSurfaceId: Id }
	/** Latest Slice-scoped external operation failed before correction could run; explicit manual retry/recovery operation will be added later. */
	| { type: 'slice-operation-failed'; actionId: Id }
	/** Slice is otherwise initially executable, but its Slice Artifact has not been created yet. */
	| { type: 'needs-artifact-creation' }
	| { type: 'executable'; mode: 'initial' }
	| { type: 'executable'; mode: 'correction'; failureChain: FailureChain }
