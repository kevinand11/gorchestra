import type { AgentRunRuntimeError, ModelAgentRunRuntime } from './types'
import { acceptAgentRunSandboxRelease, acceptDispatchRequest, exclusiveDeliverySchedulerClaim } from '../../commands/utils/dispatch'
import type { AgentRun } from '../../domain/agent-run'
import { updateRecord, withTransaction } from '../../storage/helpers'
import { runtimeRecord } from '../../utils/runtime-values'
import type { Result } from '../../utils/types'

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
	const updated = await withTransaction<string[], AgentRunRuntimeError>(runtime.services, async (storage) => {
		const stored = await updateRecord('agent-run', storage, agentRun.id, { completed: completed.value })
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
