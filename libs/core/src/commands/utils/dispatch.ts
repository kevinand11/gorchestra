import { nonEmptyTrimmedStringPipe, type Id } from '../../domain/commons'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { CoreDispatchRequest, CoreServices } from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

export async function acceptDispatchRequest(
	dispatcher: CoreServices['dispatcher'],
	input: CoreDispatchRequest,
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	const marker = await dispatcher.request(input)
	return validateCoreServiceOutput(nonEmptyTrimmedStringPipe, marker, 'dispatcher', 'request')
}

export function acceptAgentRunSandboxRelease(
	dispatcher: CoreServices['dispatcher'],
	agentRunId: Id,
): Promise<Result<string, InvalidCoreServiceOutputError>> {
	return acceptDispatchRequest(dispatcher, { type: 'agent-run-sandbox-release', agentRunId, serializationKey: agentRunId })
}
