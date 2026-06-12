import { invariant, ok } from './result'
import type { DeliveryArtifact, SliceArtifact } from '../../../domain/artifact'
import type { Id } from '../../../domain/commons'
import type { Slice } from '../../../domain/slice'
import type { InvariantViolationError } from '../../../errors'
import type { Result } from '../../types'

export function singleDeliveryArtifact(
	deliveryId: Id,
	artifacts: DeliveryArtifact[],
): Result<DeliveryArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.deliveryId === deliveryId)
	if (matching.length > 1) return invariant(`Delivery ${deliveryId} has multiple Delivery Artifacts.`)

	return ok(matching[0] ?? null)
}

export function singleSliceArtifact(slice: Slice, artifacts: SliceArtifact[]): Result<SliceArtifact | null, InvariantViolationError> {
	const matching = artifacts.filter((artifact) => artifact.sliceId === slice.id)
	if (matching.length > 1) return invariant(`Slice ${slice.id} has multiple Slice Artifacts.`)

	return ok(matching[0] ?? null)
}
