import { handleDeliveryWorkState } from './handlers'
import { workedActions } from './handlers/result'
import type { Error, Result } from './types'
import type { Action } from '../../domain/action'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices, CoreStorageTransaction } from '../../services'
import { nextId, putRecord, runtimeRecord } from '../../utils/command-storage'
import { buildDeliveryContext, getDeliveryState, type DeliveryContext, type DeliveryWorkResolution } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryPreflightInputsStillCurrent,
	providerBackedDeliveryWorkResolution,
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

export type SchedulerPreflightWriteReadiness =
	| { type: 'ready'; deliveryContext: DeliveryContext; state: DeliveryWorkState }
	| { type: 'conflict' }

export interface SchedulerHandlerContext {
	deliveryContext: DeliveryContext
	workResolution: DeliveryWorkResolution
}

export interface ResolvedSchedulerHandlerContext extends SchedulerHandlerContext {
	services: CoreServices
	tx: CoreStorageTransaction
}

export async function readSchedulerPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? schedulerPreflightForState(services, tx, deliveryContext.value, stateResult.value) : stateResult
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
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	claim: ProviderBackedSchedulerPreflightClaim,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const readiness = await readFreshSchedulerPreflightReadiness(tx, deliveryId, claim)
	if (!readiness.ok) return readiness
	if (readiness.value.type === 'conflict') return schedulerPreflightClaimConflict()

	return applyCurrentSchedulerPreflight(services, tx, readiness.value.deliveryContext, readiness.value.state, claim.preflight, checks)
}

export async function readFreshSchedulerPreflightReadiness(
	tx: CoreStorageTransaction,
	deliveryId: string,
	claim: ProviderBackedSchedulerPreflightClaim,
): Promise<CoreResult<SchedulerPreflightWriteReadiness, Exclude<Error, InvalidInputError>>> {
	const current = await currentSchedulerPreflightState(tx, deliveryId)
	if (!current.ok) return current
	if (!isSchedulerPreflightState(current.value.state)) return schedulerPreflightConflict()

	return freshSchedulerPreflightReadiness(tx, current.value.deliveryContext, current.value.state, claim.preflight)
}

export function schedulerPreflightClaimConflict(): CoreResult<Result, never> {
	return { ok: true, value: { processedCount: 0, failures: [] } }
}

export function schedulerHandlerContextFromClaim(
	claim: ProviderBackedSchedulerPreflightClaim,
): CoreResult<SchedulerHandlerContext, Exclude<Error, InvalidInputError>> {
	const resolution = providerBackedDeliveryWorkResolution(claim.preflight)
	return resolution === undefined
		? missingSchedulerWorkResolution()
		: { ok: true, value: { deliveryContext: claim.deliveryContext, workResolution: resolution } }
}

export function resolvedSchedulerHandlerContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	claim: ProviderBackedSchedulerPreflightClaim,
): CoreResult<ResolvedSchedulerHandlerContext, Exclude<Error, InvalidInputError>> {
	const resolution = providerBackedDeliveryWorkResolution(claim.preflight)
	return resolution === undefined
		? missingSchedulerWorkResolution()
		: { ok: true, value: { services, tx, deliveryContext, workResolution: resolution } }
}

async function schedulerPreflightForState(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
): Promise<CoreResult<SchedulerPreflightRead, Exclude<Error, InvalidInputError>>> {
	if (isSchedulerPreflightState(state)) {
		const preflight = await readProviderBackedDeliveryPreflightPlan(tx, deliveryContext)
		return preflight.ok
			? { ok: true, value: { type: 'provider-backed', deliveryContext, state, preflight: preflight.value } }
			: preflight
	}

	const handled = await handleDeliveryWorkState({ services, tx, deliveryContext }, state)
	return handled.ok ? { ok: true, value: { type: 'result', result: handled.value } } : handled
}

function isSchedulerPreflightState(state: DeliveryWorkState): boolean {
	return !['closed', 'unqueued', 'dependency-blocked', 'preflight-failed', 'ready-to-ship'].includes(state.type)
}

async function currentSchedulerPreflightState(
	tx: CoreStorageTransaction,
	deliveryId: string,
): Promise<CoreResult<{ deliveryContext: DeliveryContext; state: DeliveryWorkState }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const stateResult = getDeliveryState(deliveryContext.value)
	return stateResult.ok ? { ok: true, value: { deliveryContext: deliveryContext.value, state: stateResult.value } } : stateResult
}

async function freshSchedulerPreflightReadiness(
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
	preflight: ProviderBackedDeliveryPreflightPlan,
): Promise<CoreResult<SchedulerPreflightWriteReadiness, Exclude<Error, InvalidInputError>>> {
	const freshness = await providerBackedDeliveryPreflightInputsStillCurrent(tx, deliveryContext, preflight)
	if (!freshness.ok) return freshness

	return freshness.value ? { ok: true, value: { type: 'ready', deliveryContext, state } } : schedulerPreflightConflict()
}

function schedulerPreflightConflict(): CoreResult<Extract<SchedulerPreflightWriteReadiness, { type: 'conflict' }>, never> {
	return { ok: true, value: { type: 'conflict' } }
}

function applyCurrentSchedulerPreflight(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	state: DeliveryWorkState,
	preflight: ProviderBackedDeliveryPreflightPlan,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> | CoreResult<Result, Exclude<Error, InvalidInputError>> {
	return deliveryPreflightChecksPassed(checks)
		? handleDeliveryWorkState(schedulerHandlerContext(services, tx, deliveryContext, preflight), state)
		: writeFailedPreflightAction(services, tx, deliveryContext.delivery.id, checks)
}

function schedulerHandlerContext(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryContext: DeliveryContext,
	preflight: ProviderBackedDeliveryPreflightPlan,
) {
	const resolution = providerBackedDeliveryWorkResolution(preflight)
	return resolution === undefined ? { services, tx, deliveryContext } : { services, tx, deliveryContext, workResolution: resolution }
}

async function writeFailedPreflightAction(
	services: CoreServices,
	tx: CoreStorageTransaction,
	deliveryId: string,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const actionId = nextId(services, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(services)
	if (!performed.ok) return performed

	const action: Action = {
		id: actionId.value,
		deliveryId,
		performed: performed.value,
		authorized: null,
		result: { type: 'validate-preflight', checks },
	}
	const put = await putRecord('action', tx.actions, action.id, action)
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
