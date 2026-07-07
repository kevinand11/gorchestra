import type { CoreRuntime } from '../runtime'
import { createPrepareAgentRunOperation } from './prepare-agent-run'
import { createProcessDeliveryWorkOperation } from './process-delivery-work-operation'
import { createReleaseAgentRunSandboxOperation } from './release-agent-run-sandbox'
import { createRunModelAgentRunOperation } from './run-model-agent-run'
import { createScheduleDeliveryWorkOperation } from './schedule-delivery-work'

export type * from './types'
export type * as PrepareAgentRun from './prepare-agent-run'
export type * as ProcessDeliveryWorkOperation from './process-delivery-work-operation'
export type * as ReleaseAgentRunSandbox from './release-agent-run-sandbox'
export type * as RunModelAgentRun from './run-model-agent-run'
export type * as ScheduleDeliveryWork from './schedule-delivery-work'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
		prepareAgentRun: createPrepareAgentRunOperation(runtime),
		releaseAgentRunSandbox: createReleaseAgentRunSandboxOperation(runtime),
		scheduleDeliveryWork: createScheduleDeliveryWorkOperation(runtime),
		processDeliveryWorkOperation: createProcessDeliveryWorkOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
