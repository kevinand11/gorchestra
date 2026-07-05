import type { CoreRuntime } from '../runtime'
import { createProcessDeliveryWorkOperation } from './process-delivery-work-operation'
import { createRunModelAgentRunOperation } from './run-model-agent-run'
import { createScheduleDeliveryWorkOperation } from './schedule-delivery-work'

export type * from './types'
export type * as ProcessDeliveryWorkOperation from './process-delivery-work-operation'
export type * as RunModelAgentRun from './run-model-agent-run'
export type * as ScheduleDeliveryWork from './schedule-delivery-work'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
		scheduleDeliveryWork: createScheduleDeliveryWorkOperation(runtime),
		processDeliveryWorkOperation: createProcessDeliveryWorkOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
