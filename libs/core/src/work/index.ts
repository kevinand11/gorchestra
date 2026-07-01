import type { CoreRuntime } from '../runtime'
import { createRunModelAgentRunOperation } from './run-model-agent-run'

export type * from './types'
export type * as RunModelAgentRun from './run-model-agent-run'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
