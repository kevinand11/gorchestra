import type { Action } from '../../domain/action'
import type { DeliveryWorkState } from '../../domain/delivery'
import type { InvalidInputError } from '../../errors'
import type { CoreStorage } from '../../services'
import {
	buildDeliveryContext,
	getDeliveryState,
	resolveDeliveryWork,
	type DeliveryContext,
	type DeliveryWorkResolution,
} from '../../utils/delivery-context'
import type { CoreRuntime } from '../../utils/runtime'
import { nextId, runtimeRecord } from '../../utils/runtime-values'
import { createRecord } from '../../utils/storage/helpers'
import type { Result as CoreResult } from '../../utils/types'
import type { Error, Result } from '../delivery-work/types'

export type SchedulerWorkRead = { type: 'result'; result: Result } | SchedulerWorkClaim

export type SchedulerWorkClaim = {
	type: 'work'
	deliveryContext: DeliveryContext
	state: DeliveryWorkState
	workResolution: DeliveryWorkResolution
}

export async function readSchedulerWork(
	runtime: CoreRuntime,
	storage: CoreStorage,
	deliveryId: string,
): Promise<CoreResult<SchedulerWorkRead, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const state = getDeliveryState(deliveryContext.value)
	if (!state.ok) return state
	if (!isSchedulerActionableState(state.value)) return { ok: true, value: { type: 'result', result: completed() } }

	const resolution = await resolveDeliveryWork(storage, deliveryContext.value)
	if (!resolution.ok) return resolution

	if (resolution.value.type === 'failed') {
		const actionId = nextId(runtime.values)
		if (!actionId.ok) return actionId

		const performed = runtimeRecord(runtime.values)
		if (!performed.ok) return performed

		const action: Action = {
			id: actionId.value,
			deliveryId,
			performed: performed.value,
			authorized: null,
			result: { type: 'validate-preflight', checks: resolution.value.checks },
		}
		const put = await createRecord('action', storage, action)
		return put.ok ? { ok: true, value: { type: 'result', result: completed(1) } } : put
	}

	return {
		ok: true,
		value: {
			type: 'work',
			deliveryContext: deliveryContext.value,
			state: state.value,
			workResolution: resolution.value.resolution,
		},
	}
}

function isSchedulerActionableState(state: DeliveryWorkState): boolean {
	switch (state.type) {
		case 'needs-artifact-creation':
		case 'slices-incomplete':
		case 'needs-artifact-validation':
		case 'needs-review-surface':
			return true
		case 'closed':
		case 'unqueued':
		case 'operation-running':
		case 'operation-queued':
		case 'dependency-blocked':
		case 'preflight-failed':
		case 'delivery-operation-failed':
		case 'delivery-validation-failed':
		case 'delivery-review-failed':
		case 'awaiting-review':
		case 'ready-to-ship':
			return false
		default:
			throw new Error(`Unexpected Delivery Work State: ${String(state satisfies never)}`)
	}
}

function completed(processedCount = 0): Result {
	return { processedCount, failures: [] }
}
