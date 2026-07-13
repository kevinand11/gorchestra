import type { Id } from '../domain/commons'
import type { InvalidCoreServiceOutputError } from '../errors'
import type { CoreDispatchRequest, DispatchCoordinationClaim } from '../services'
import type { CoreTransactionDispatch } from './transactions'
import type { Result } from './types'

export function exclusiveAgentRunClaim(agentRunId: Id): DispatchCoordinationClaim {
	return { scope: [{ type: 'agent-run', id: agentRunId }], mode: { type: 'exclusive' } }
}

export function exclusiveDeliverySchedulerClaim(deliveryId: Id): DispatchCoordinationClaim {
	return { scope: [{ type: 'delivery', id: deliveryId }, { type: 'scheduler' }], mode: { type: 'exclusive' } }
}

export function exclusiveDeliveryClaim(deliveryId: Id): DispatchCoordinationClaim {
	return { scope: [{ type: 'delivery', id: deliveryId }], mode: { type: 'exclusive' } }
}

export function deliverySliceOperationClaims(deliveryId: Id, sliceId: Id, capacity: number): DispatchCoordinationClaim[] {
	return [
		{ scope: [{ type: 'delivery', id: deliveryId }, { type: 'slice-pool' }], mode: { type: 'shared-capacity', capacity } },
		{
			scope: [
				{ type: 'delivery', id: deliveryId },
				{ type: 'slice', id: sliceId },
			],
			mode: { type: 'exclusive' },
		},
	]
}

export function requestAgentRunPreparation(
	dispatch: CoreTransactionDispatch,
	agentRunId: Id,
	reason: Extract<CoreDispatchRequest, { type: 'agent-run-preparation' }>['reason'],
): Promise<Result<void, InvalidCoreServiceOutputError>> {
	return dispatch.request({
		type: 'agent-run-preparation',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason,
	})
}

export function requestAgentRunModelTurn(
	dispatch: CoreTransactionDispatch,
	agentRunId: Id,
	inputEventId: Id,
): Promise<Result<void, InvalidCoreServiceOutputError>> {
	return dispatch.request({
		type: 'agent-run-model-turn',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason: { type: 'input-appended', inputEventId },
	})
}

export function requestAgentRunSandboxRelease(
	dispatch: CoreTransactionDispatch,
	agentRunId: Id,
): Promise<Result<void, InvalidCoreServiceOutputError>> {
	return dispatch.request({
		type: 'agent-run-sandbox-release',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason: { type: '01k00000000000000000100019' },
	})
}
