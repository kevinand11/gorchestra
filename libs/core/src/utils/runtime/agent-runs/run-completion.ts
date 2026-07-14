import type { AgentRunRuntimeError, ModelAgentRunRuntime } from './types'
import { requestAgentRunSandboxRelease } from '../../../dispatch/accept'
import { registerDispatchTerminalFinalizer } from '../../../dispatch/attempt-context'
import { exclusiveDeliverySchedulerClaim } from '../../../dispatch/claims'
import type { AgentRun } from '../../../domain/agent-run'
import { updateAgentRunRecord } from '../../agent-runs'
import { runtimeRecord } from '../../runtime-values'
import type { CoreTransaction } from '../../transactions'
import type { Result } from '../../types'

export function completeAutonomousRunIfNeeded(
	runtime: ModelAgentRunRuntime,
	agentRun: AgentRun,
): Promise<Result<void, AgentRunRuntimeError>> | Result<void, never> {
	return agentRun.purpose.type === 'execution' || agentRun.purpose.type === 'revision-execution'
		? completeAgentRun(runtime, agentRun)
		: { ok: true, value: undefined }
}

async function completeAgentRun(runtime: ModelAgentRunRuntime, agentRun: AgentRun): Promise<Result<void, AgentRunRuntimeError>> {
	const completed = runtimeRecord(runtime.values)
	if (!completed.ok) return completed
	if (registerDispatchTerminalFinalizer((tx) => completeAgentRunInTransaction(runtime, tx, agentRun, completed.value))) {
		return { ok: true, value: undefined }
	}
	return runtime.transactions.run<void, AgentRunRuntimeError>((tx) =>
		completeAgentRunInTransaction(runtime, tx, agentRun, completed.value),
	)
}

async function completeAgentRunInTransaction(
	_runtime: ModelAgentRunRuntime,
	{ storage, notifications, dispatch }: CoreTransaction,
	agentRun: AgentRun,
	completed: { at: string },
): Promise<Result<void, AgentRunRuntimeError>> {
	const stored = await updateAgentRunRecord(storage, notifications, agentRun.id, { completed })
	if (!stored.ok) return stored

	if (agentRun.purpose.type === 'execution') {
		const schedulerRequested = await dispatch.request({
			payload: { type: 'delivery-work-scheduler', deliveryId: agentRun.purpose.deliveryId },
			coordinationClaims: [exclusiveDeliverySchedulerClaim(agentRun.purpose.deliveryId)],
			deduplicationKey: { type: 'delivery-work-scheduler', deliveryId: agentRun.purpose.deliveryId },
			reason: { type: 'delivery-work-requested' },
		})
		if (!schedulerRequested.ok) return schedulerRequested
	}

	return requestAgentRunSandboxRelease(dispatch, agentRun.id)
}
