import { nonEmptyTrimmedStringPipe, type Id } from '../../domain/commons'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { CoreDispatchRequest, CoreServices, DispatchCoordinationClaim } from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

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
