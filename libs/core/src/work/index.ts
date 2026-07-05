import type { CoreRuntime } from '../runtime'
import { createScheduleDeliveryWorkOperation } from './run-delivery-work'
import { createRunModelAgentRunOperation } from './run-model-agent-run'

export type * from './types'
export type * as RunModelAgentRun from './run-model-agent-run'
export type * as ScheduleDeliveryWork from './run-delivery-work'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
		scheduleDeliveryWork: createScheduleDeliveryWorkOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
