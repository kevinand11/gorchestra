import type { CoreRuntime } from '../runtime'
import { createPrepareAgentRunSandboxOperation } from './prepare-agent-run-sandbox'
import { createReleaseAgentRunSandboxOperation } from './release-agent-run-sandbox'
import { createRunDeliveryWorkOperation } from './run-delivery-work'
import { createRunModelAgentRunOperation } from './run-model-agent-run'

export type * from './types'
export type * as PrepareAgentRunSandbox from './prepare-agent-run-sandbox'
export type * as ReleaseAgentRunSandbox from './release-agent-run-sandbox'
export type * as RunDeliveryWork from './run-delivery-work'
export type * as RunModelAgentRun from './run-model-agent-run'

export function createCoreWork(runtime: CoreRuntime) {
	return {
		runModelAgentRun: createRunModelAgentRunOperation(runtime),
		prepareAgentRunSandbox: createPrepareAgentRunSandboxOperation(runtime),
		releaseAgentRunSandbox: createReleaseAgentRunSandboxOperation(runtime),
		runDeliveryWork: createRunDeliveryWorkOperation(runtime),
	}
}

export type Core = ReturnType<typeof createCoreWork>
