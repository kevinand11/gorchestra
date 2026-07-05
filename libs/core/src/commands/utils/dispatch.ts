import type { AgentRun, AgentRunPurpose } from '../../domain/agent-run'
import { nonEmptyTrimmedStringPipe, type Id, type RuntimeRecord } from '../../domain/commons'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { CoreDispatchRequest, CoreServices, CoreStorage, DispatchCoordinationClaim } from '../../services'
import { completeSingleAgentRunByPurpose, getSingleAgentRunByPurpose, type AgentRunCompletionError } from '../../utils/agent-runs'
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

export function acceptAgentRunSandboxPreparation(
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
	reason: Extract<CoreDispatchRequest, { type: 'agent-run-sandbox-preparation' }>['reason'],
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	return acceptDispatchRequest(dispatcher, {
		type: 'agent-run-sandbox-preparation',
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
		reason: { type: 'agent-run-completed' },
	})
}

export async function completeAgentRunByPurposeAndAcceptSandboxRelease(
	storage: CoreStorage,
	dispatcher: CoreServices['dispatcher'],
	purpose: AgentRunPurpose,
	completed: RuntimeRecord,
): Promise<Result<{ agentRun: AgentRun; dispatchMarker: string | null }, AgentRunCompletionError | InvalidCoreServiceOutputError>> {
	const current = await getSingleAgentRunByPurpose(storage, purpose)
	if (!current.ok) return current
	if (current.value.completed !== null) return { ok: true, value: { agentRun: current.value, dispatchMarker: null } }

	const agentRun = await completeSingleAgentRunByPurpose(storage, purpose, completed)
	if (!agentRun.ok) return agentRun

	const dispatchMarker = await acceptAgentRunSandboxRelease(dispatcher, agentRun.value.id)
	return dispatchMarker.ok ? { ok: true, value: { agentRun: agentRun.value, dispatchMarker: dispatchMarker.value } } : dispatchMarker
}
