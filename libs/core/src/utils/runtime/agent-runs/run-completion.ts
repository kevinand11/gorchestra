import type { AgentRunRuntimeError, ModelAgentRunRuntime } from './types'
import type { AgentRun } from '../../../domain/agent-run'
import { updateAgentRunRecord } from '../../agent-runs'
import { acceptAgentRunSandboxRelease, acceptDispatchRequest, exclusiveDeliverySchedulerClaim } from '../../dispatch'
import { withNotificationTransaction } from '../../notifications'
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
	const updated = await withNotificationTransaction<string[], AgentRunRuntimeError>(runtime, async (storage, notifications) => {
		const stored = await updateAgentRunRecord(storage, notifications, agentRun.id, { completed: completed.value })
		if (!stored.ok) return stored

		const schedulerMarker =
			agentRun.purpose.type === 'execution'
				? await acceptDispatchRequest(runtime.services.dispatcher, {
						type: 'delivery-work-scheduler',
						deliveryId: agentRun.purpose.deliveryId,
						coordinationClaims: [exclusiveDeliverySchedulerClaim(agentRun.purpose.deliveryId)],
						reason: { type: 'delivery-work-requested' },
					})
				: null
		if (schedulerMarker !== null && !schedulerMarker.ok) return schedulerMarker

		const releaseMarker = await acceptAgentRunSandboxRelease(runtime.services.dispatcher, agentRun.id)
		if (!releaseMarker.ok) return releaseMarker

		return { ok: true, value: [...(schedulerMarker === null ? [] : [schedulerMarker.value]), releaseMarker.value] }
	})
	if (!updated.ok) return updated

	for (const marker of updated.value) runtime.services.dispatcher.ready(marker)
	return { ok: true, value: undefined }
}
