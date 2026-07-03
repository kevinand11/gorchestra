import type { AgentRun, AgentRunPurpose } from '../domain/agent-run'
import type { RuntimeRecord } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorage } from '../services'
import type { Result } from './types'
import { listRecords, updateRecord } from '../storage/helpers'

export type AgentRunLookupError = InvalidCoreServiceOutputError | StorageOperationFailedError | InvariantViolationError
export type AgentRunCompletionError = AgentRunLookupError | ResourceNotFoundError

export async function getSingleAgentRunByPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
): Promise<Result<AgentRun, AgentRunLookupError>> {
	const agentRuns = await listRecords('agent-run', storage, { where: (filter, fields) => filter.eq(fields.purpose, purpose) })
	return agentRuns.ok ? singleAgentRunByPurpose(agentRuns.value, purpose) : agentRuns
}

export async function completeSingleAgentRunByPurpose(
	storage: CoreStorage,
	purpose: AgentRunPurpose,
	completed: RuntimeRecord,
): Promise<Result<AgentRun, AgentRunCompletionError>> {
	const agentRun = await getSingleAgentRunByPurpose(storage, purpose)
	if (!agentRun.ok) return agentRun

	return agentRun.value.completed === null
		? updateRecord('agent-run', storage, agentRun.value.id, { completed })
		: { ok: true, value: agentRun.value }
}

function singleAgentRunByPurpose(agentRuns: AgentRun[], purpose: AgentRunPurpose): Result<AgentRun, InvariantViolationError> {
	const purposeKey = agentRunPurposeKey(purpose)
	const matching = agentRuns.filter((agentRun) => agentRunPurposeKey(agentRun.purpose) === purposeKey)
	return matching.length === 1 ? { ok: true, value: matching[0]! } : agentRunCountInvariant(purpose, matching.length)
}

function agentRunPurposeKey(purpose: AgentRunPurpose): string {
	return `${purpose.type}:${JSON.stringify(purpose)}`
}

function agentRunCountInvariant(purpose: AgentRunPurpose, count: number): Result<never, InvariantViolationError> {
	return invariant(`Expected exactly one Agent Run for ${agentRunPurposeDescription(purpose)} but found ${count}.`)
}

function agentRunPurposeDescription(purpose: AgentRunPurpose): string {
	return `${purpose.type} ${agentRunPurposeKey(purpose)}`
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}
