import type { AgentRunRuntimeError, ModelAgentRunRuntime } from './types'
import type { AgentRun } from '../../../domain/agent-run'
import { updateAgentRunRecord } from '../../agent-runs'
import { exclusiveDeliverySchedulerClaim, requestAgentRunSandboxRelease } from '../../dispatch'
import { runtimeRecord } from '../../runtime-values'
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
	return runtime.transactions.run<void, AgentRunRuntimeError>(async ({ storage, notifications, dispatch }) => {
		const stored = await updateAgentRunRecord(storage, notifications, agentRun.id, { completed: completed.value })
		if (!stored.ok) return stored

		if (agentRun.purpose.type === 'execution') {
			const schedulerRequested = await dispatch.request({
				type: 'delivery-work-scheduler',
				deliveryId: agentRun.purpose.deliveryId,
				coordinationClaims: [exclusiveDeliverySchedulerClaim(agentRun.purpose.deliveryId)],
				reason: { type: 'delivery-work-requested' },
			})
			if (!schedulerRequested.ok) return schedulerRequested
		}

		return requestAgentRunSandboxRelease(dispatch, agentRun.id)
	})
}
