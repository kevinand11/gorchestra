import { nonEmptyTrimmedStringPipe, type Id } from '../domain/commons'
import type { InvalidCoreServiceOutputError } from '../errors'
import type { CoreDispatchRequest, CoreServices, DispatchCoordinationClaim } from '../services'
import type { Result } from './types'
import { validateCoreServiceOutput } from '../validation'

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

export async function acceptDispatchRequest(
	dispatcher: CoreServices['dispatcher'],
	input: CoreDispatchRequest,
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	const marker = await dispatcher.request(input)
	return validateCoreServiceOutput(nonEmptyTrimmedStringPipe, marker, 'dispatcher', 'request')
}

export function acceptAgentRunPreparation(
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
	reason: Extract<CoreDispatchRequest, { type: 'agent-run-preparation' }>['reason'],
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	return acceptDispatchRequest(dispatcher, {
		type: 'agent-run-preparation',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason,
	})
}

export function acceptAgentRunModelTurn(
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
	inputEventId: Id,
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	return acceptDispatchRequest(dispatcher, {
		type: 'agent-run-model-turn',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason: { type: 'input-appended', inputEventId },
	})
}

export function acceptAgentRunSandboxRelease(
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	return acceptDispatchRequest(dispatcher, {
		type: 'agent-run-sandbox-release',
		agentRunId,
		coordinationClaims: [exclusiveAgentRunClaim(agentRunId)],
		reason: { type: '01k00000000000000000100019' },
	})
}
