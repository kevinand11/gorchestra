import type { CoreRuntime } from '../runtime'
import { createRunDeliveryWorkOperation } from './run-delivery-work'
import { createRunModelAgentRunOperation } from './run-model-agent-run'

export type * from './types'
export type * as RunDeliveryWork from './run-delivery-work'
export type * as RunModelAgentRun from './run-model-agent-run'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
		runDeliveryWork: createRunDeliveryWorkOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
