import {
	deliveryArtifactValidationClaim,
	recordDeliveryArtifactValidationResult,
	type DeliveryArtifactValidationClaim,
} from './handlers/delivery-needs-artifact-validation'
import {
	recordSliceArtifactValidationResult,
	sliceArtifactValidationClaim,
	type SliceArtifactValidationClaim,
} from './handlers/slice-needs-artifact-validation'
import {
	recordSliceDeliveryArtifactValidationResult,
	sliceDeliveryArtifactValidationClaim,
	type SliceDeliveryArtifactValidationClaim,
} from './handlers/slice-needs-delivery-validation'
import type { ProviderBackedSchedulerPreflightClaim } from './preflight'
import type { Error, Result } from './types'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import type { DeliveryContext } from '../../utils/delivery-context'
import { withTransaction } from '../../utils/storage'
import type { Result as CoreResult } from '../../utils/types'

type ArtifactValidationClaim =
	| { type: 'delivery-artifact'; claim: DeliveryArtifactValidationClaim }
	| { type: 'slice-artifact'; claim: SliceArtifactValidationClaim }
	| { type: 'slice-delivery-artifact'; claim: SliceDeliveryArtifactValidationClaim }

export async function runArtifactValidationIfClaimed(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>> | null> {
	const claim = readArtifactValidationClaim(preflight)
	if (!claim.ok) return claim
	if (claim.value === null) return null

	const validationClaim = claim.value
	return withTransaction(runtime.services, (tx) =>
		applyArtifactValidationResult(runtime.services, tx, deliveryId, preflight, validationClaim),
	)
}

const artifactValidationClaimReaders: Partial<
	Record<
		DeliveryWorkState['type'],
		(preflight: ProviderBackedSchedulerPreflightClaim) => CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>>
	>
> = {
	'needs-artifact-validation': deliveryArtifactValidationClaimFromPreflight,
	'slices-incomplete': sliceValidationClaimFromPreflight,
}

function readArtifactValidationClaim(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	return artifactValidationClaimReaders[preflight.state.type]?.(preflight) ?? { ok: true, value: null }
}

function deliveryArtifactValidationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim, never> {
	return { ok: true, value: { type: 'delivery-artifact', claim: deliveryArtifactValidationClaim(preflight) } }
}

function sliceValidationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const deliveryValidationClaim = sliceDeliveryArtifactValidationClaimFromPreflight(preflight)
	if (!deliveryValidationClaim.ok || deliveryValidationClaim.value !== null) return deliveryValidationClaim

	return sliceArtifactValidationClaimFromPreflight(preflight)
}

function sliceDeliveryArtifactValidationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const claim = sliceDeliveryArtifactValidationClaim(preflight)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-delivery-artifact', claim: claim.value } } : claim
}

function sliceArtifactValidationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactValidationClaim | null, Exclude<Error, InvalidInputError>> {
	const claim = sliceArtifactValidationClaim(preflight)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-artifact', claim: claim.value } } : claim
}

async function applyArtifactValidationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	_deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactValidationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const context = { services, tx, deliveryContext: preflight.deliveryContext }
	return recordArtifactValidationResult(context, preflight.state, claim)
}

function recordArtifactValidationResult(
	context: { services: CoreServices; tx: CoreStorageTransaction; deliveryContext: DeliveryContext },
	state: DeliveryWorkState,
	claim: ArtifactValidationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	if (claim.type === 'delivery-artifact') return recordDeliveryArtifactValidationResult(context, state, claim.claim)
	if (claim.type === 'slice-artifact') return recordSliceArtifactValidationResult(context, state, claim.claim)

	return recordSliceDeliveryArtifactValidationResult(context, state, claim.claim)
}
