import { handleDeliveryWorkState } from './handlers'
import { workedActions } from './handlers/result'
import type { Error, Result } from './types'
import type { Action } from '../../domain/action'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorage, ResolvableSecretValue } from '../../services'
import { createRecord, nextId, runtimeRecord } from '../../utils/command-storage'
import { buildDeliveryContext, getDeliveryState, type DeliveryContext, type DeliveryWorkResolution } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryWorkResolution,
	providerBackedRepositoryAccessSecret,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
	type ProviderBackedDeliveryPreflightPlan,
} from '../../utils/delivery-preflight'
import type { Result as CoreResult } from '../../utils/types'

export type SchedulerPreflightRead = { type: 'result'; result: Result } | ProviderBackedSchedulerPreflightClaim

export type ProviderBackedSchedulerPreflightClaim = {
	type: 'provider-backed'
	deliveryContext: DeliveryContext
	state: DeliveryWorkState
	preflight: ProviderBackedDeliveryPreflightPlan
}

export interface SchedulerHandlerContext {
	deliveryContext: DeliveryContext
	workResolution: DeliveryWorkResolution
	repositoryAccessSecret: ResolvableSecretValue
}

export interface ResolvedSchedulerHandlerContext extends SchedulerHandlerContext {
	services: CoreServices
	storage: CoreStorage
	values: CoreRuntime['values']
}

export async function readSchedulerPreflight(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryId: string,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? schedulerPreflightForState(runtime, storage, deliveryContext.value, stateResult.value) : stateResult
}

export async function runSchedulerPreflightChecks(
	runtime: CoreRuntime,
	claim: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<ValidationEvidence[], Exclude<Error, InvalidInputError>>> {
	return runProviderBackedDeliveryPreflightChecks(runtime, claim.preflight)
}

export function schedulerPreflightChecksPassed(checks: ValidationEvidence[]): boolean {
	return deliveryPreflightChecksPassed(checks)
}

export async function applySchedulerPreflightChecks(
	runtime: CoreRuntime,
	storage: CoreStorage,
	_deliveryId: string,
	claim: ProviderBackedSchedulerPreflightClaim,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return applyCurrentSchedulerPreflight(runtime, storage, claim.deliveryContext, claim.state, claim.preflight, checks)
}

export function schedulerHandlerContextFromClaim(
	claim: ProviderBackedSchedulerPreflightClaim,
): CoreResult<SchedulerHandlerContext, Exclude<Error, InvalidInputError>> {
	const resolution = providerBackedDeliveryWorkResolution(claim.preflight)
	const repositoryAccessSecret = providerBackedRepositoryAccessSecret(claim.preflight)
	return resolution === undefined || repositoryAccessSecret === undefined
		? missingSchedulerWorkResolution()
		: { ok: true, value: { deliveryContext: claim.deliveryContext, workResolution: resolution, repositoryAccessSecret } }
}

export function resolvedSchedulerHandlerContext(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryContext: DeliveryContext,
	claim: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ResolvedSchedulerHandlerContext, Exclude<Error, InvalidInputError>> {
	const resolution = providerBackedDeliveryWorkResolution(claim.preflight)
	const repositoryAccessSecret = providerBackedRepositoryAccessSecret(claim.preflight)
	return resolution === undefined || repositoryAccessSecret === undefined
		? missingSchedulerWorkResolution()
		: {
				ok: true,
				value: {
					services: runtime.services,
					storage,
					values: runtime.values,
					deliveryContext,
					workResolution: resolution,
					repositoryAccessSecret,
				},
			}
}

async function schedulerPreflightForState(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	if (isSchedulerPreflightState(state)) {
		const preflight = await readProviderBackedDeliveryPreflightPlan(storage, deliveryContext)
		return preflight.ok
			? { ok: true, value: { type: 'provider-backed', deliveryContext, state, preflight: preflight.value } }
			: preflight
	}

	const handled = await handleDeliveryWorkState({ services: runtime.services, storage, values: runtime.values, deliveryContext }, state)
	return handled.ok ? { ok: true, value: { type: 'result', result: handled.value } } : handled
}

function isSchedulerPreflightState(state: DeliveryWorkState): boolean {
	return !['closed', 'unqueued', 'dependency-blocked', 'preflight-failed', 'ready-to-ship'].includes(state.type)
}

function applyCurrentSchedulerPreflight(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
	preflight: ProviderBackedDeliveryPreflightPlan,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return deliveryPreflightChecksPassed(checks)
		? handleDeliveryWorkState(schedulerHandlerContext(runtime, storage, deliveryContext, preflight), state, runtime)
		: writeFailedPreflightAction(runtime, storage, deliveryContext.delivery.id, checks)
}

function schedulerHandlerContext(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryContext: DeliveryContext,
	preflight: ProviderBackedDeliveryPreflightPlan,
) {
	const resolution = providerBackedDeliveryWorkResolution(preflight)
	const repositoryAccessSecret = providerBackedRepositoryAccessSecret(preflight)
	return resolution === undefined || repositoryAccessSecret === undefined
		? { services: runtime.services, storage, values: runtime.values, deliveryContext }
		: {
				services: runtime.services,
				storage,
				values: runtime.values,
				deliveryContext,
				workResolution: resolution,
				repositoryAccessSecret,
			}
}

async function writeFailedPreflightAction(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryId: string,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const actionId = nextId(runtime.values, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(runtime.values)
	if (!performed.ok) return performed

	const action: Action = {
		id: actionId.value,
		deliveryId,
		performed: performed.value,
		authorized: null,
		result: { type: 'validate-preflight', checks },
	}
	const put = await createRecord('action', storage, action)
	if (!put.ok) return put

	return workedActions([action.id])
}

function missingSchedulerWorkResolution(): CoreResult<never, Exclude<Error, InvalidInputError>> {
	return {
		ok: false,
		error: {
			type: 'invariant-violation',
			message: 'Delivery Work Resolution is required for scheduler-actionable Delivery work.',
		},
	}
}
