import {
	deliveryArtifactCreationClaim,
	recordDeliveryArtifactCreationResult,
	type DeliveryArtifactCreationClaim,
} from './handlers/delivery-needs-artifact-creation'
import {
	recordSliceArtifactCreationResult,
	sliceArtifactCreationClaim,
	type SliceArtifactCreationClaim,
} from './handlers/slice-needs-artifact-creation'
import {
	resolvedSchedulerHandlerContext,
	schedulerHandlerContextFromClaim,
	type ProviderBackedSchedulerPreflightClaim,
	type ResolvedSchedulerHandlerContext,
} from './preflight'
import type { Error, Result } from './types'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { InvalidInputError } from '../../errors'
import type { SourceControlArtifactCreation } from '../../providers/source-control'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import { withTransaction } from '../../utils/storage'
import type { Result as CoreResult } from '../../utils/types'

type ArtifactCreationClaim =
	| { type: 'delivery-artifact'; claim: DeliveryArtifactCreationClaim }
	| { type: 'slice-artifact'; claim: SliceArtifactCreationClaim }

export async function runArtifactCreationIfClaimed(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>> | null> {
	const claim = readArtifactCreationClaim(preflight)
	if (!claim.ok) return claim
	if (claim.value === null) return null

	return runArtifactCreationClaim(runtime, deliveryId, preflight, claim.value)
}

async function runArtifactCreationClaim(
	runtime: CoreRuntime,
	deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const creation = await runArtifactCreation(runtime, claim)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, (tx) =>
		applyArtifactCreationResult(runtime.services, tx, deliveryId, preflight, claim, creation.value),
	)
}

const artifactCreationClaimReaders: Partial<
	Record<
		DeliveryWorkState['type'],
		(preflight: ProviderBackedSchedulerPreflightClaim) => CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>>
	>
> = {
	'needs-artifact-creation': deliveryArtifactCreationClaimFromPreflight,
	'slices-incomplete': sliceArtifactCreationClaimFromPreflight,
}

function readArtifactCreationClaim(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	return artifactCreationClaimReaders[preflight.state.type]?.(preflight) ?? { ok: true, value: null }
}

function deliveryArtifactCreationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromClaim(preflight)
	if (!handlerContext.ok) return handlerContext

	const claim = deliveryArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: { type: 'delivery-artifact', claim: claim.value } } : claim
}

function sliceArtifactCreationClaimFromPreflight(
	preflight: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ArtifactCreationClaim | null, Exclude<Error, InvalidInputError>> {
	const handlerContext = schedulerHandlerContextFromClaim(preflight)
	if (!handlerContext.ok) return handlerContext

	const claim = sliceArtifactCreationClaim(handlerContext.value)
	return claim.ok ? { ok: true, value: claim.value === null ? null : { type: 'slice-artifact', claim: claim.value } } : claim
}

async function runArtifactCreation(
	runtime: CoreRuntime,
	claim: ArtifactCreationClaim,
): Promise<CoreResult<SourceControlArtifactCreation, Exclude<Error, InvalidInputError>>> {
	return claim.type === 'delivery-artifact'
		? runtime.providers.sourceControl.createDeliveryArtifact(claim.claim)
		: runtime.providers.sourceControl.createSliceArtifact(claim.claim)
}

async function applyArtifactCreationResult(
	services: CoreServices,
	tx: CoreStorageTransaction,
	_deliveryId: string,
	preflight: ProviderBackedSchedulerPreflightClaim,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const context = resolvedSchedulerHandlerContext(services, tx, preflight.deliveryContext, preflight)
	return context.ok ? recordArtifactCreationResult(context.value, preflight.state, claim, creation) : context
}

function recordArtifactCreationResult(
	context: ResolvedSchedulerHandlerContext,
	state: DeliveryWorkState,
	claim: ArtifactCreationClaim,
	creation: SourceControlArtifactCreation,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return claim.type === 'delivery-artifact'
		? recordDeliveryArtifactCreationResult(context, state, claim.claim, creation)
		: recordSliceArtifactCreationResult(context, state, claim.claim, creation)
}
