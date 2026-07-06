import type { AgentRun } from '../domain/agent-run'
import type { Id } from '../domain/commons'
import { createCoreProviders, type CoreProviders } from '../providers'
import type { CoreServices } from '../services'
import { defaultCoreRuntimeValues, type CoreRuntimeValues } from '../utils/runtime-values'
import type { Result } from '../utils/types'
import type { AgentRunLiveEvent } from './agent-runs/live-events'
import { runModelAgentRun } from './agent-runs/model-loop'

export interface CoreAgentRunRuntimeEvents {
	onAgentRunEvent?(event: AgentRunLiveEvent): void | Promise<void>
}

export interface CoreAgentRunRuntime {
	runExecutionAgentRun(input: { agentRun: AgentRun }): Promise<void>
	runModelAgentRun(input: { agentRunId: Id }): Promise<Result<void, unknown>>
}

export interface CoreRuntimeOverrides {
	providers?: CoreProviders
	agentRuns?: CoreAgentRunRuntime
	values?: CoreRuntimeValues
}

export interface CoreRuntime {
	services: CoreServices
	providers: CoreProviders
	agentRuns: CoreAgentRunRuntime
	values: CoreRuntimeValues
}

export function createCoreRuntime(services: CoreServices, overrides: CoreRuntimeOverrides = {}): CoreRuntime {
	const runtime = coreRuntimeShell(services, overrides)
	runtime.agentRuns = agentRunRuntimeFor(runtime, overrides)
	return runtime
}

function coreRuntimeShell(services: CoreServices, overrides: CoreRuntimeOverrides): CoreRuntime {
	return {
		services,
		providers: coreProvidersFor(services, overrides),
		agentRuns: createNoopAgentRunRuntime(),
		values: coreRuntimeValuesFor(overrides),
	}
}

function coreProvidersFor(services: CoreServices, overrides: CoreRuntimeOverrides): CoreProviders {
	return overrides.providers ?? createCoreProviders(services)
}

function coreRuntimeValuesFor(overrides: CoreRuntimeOverrides): CoreRuntimeValues {
	return overrides.values ?? defaultCoreRuntimeValues()
}

function agentRunRuntimeFor(runtime: CoreRuntime, overrides: CoreRuntimeOverrides): CoreAgentRunRuntime {
	return overrides.agentRuns ?? createDefaultAgentRunRuntime(runtime)
}

function createDefaultAgentRunRuntime(runtime: CoreRuntime): CoreAgentRunRuntime {
	return {
		runExecutionAgentRun: () => Promise.resolve(),
		runModelAgentRun: ({ agentRunId }) => runModelAgentRun(runtime, agentRunId),
	}
}

function createNoopAgentRunRuntime(): CoreAgentRunRuntime {
	return {
		runExecutionAgentRun: () => Promise.resolve(),
		runModelAgentRun: () => Promise.resolve({ ok: true, value: undefined }),
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('Core runtime', () => {
		it('wires validated Core Services with internal Core Providers', () => {
			const services = createTestCoreServices()
			const runtime = createCoreRuntime(services)

			expect(runtime.services).toBe(services)
			expect(Object.keys(runtime.providers.sourceControl)).toEqual([
				'preflightRepository',
				'createArtifactBranch',
				'createReviewSurface',
			])
			expect(Object.keys(runtime.providers.modelProviderProtocols)).toEqual(['preflightModel', 'resolveLanguageModel'])
			expect(typeof runtime.agentRuns.runExecutionAgentRun).toBe('function')
			expect(typeof runtime.agentRuns.runModelAgentRun).toBe('function')
			expect(typeof runtime.values.nextId).toBe('function')
			expect(typeof runtime.values.now).toBe('function')
		})
	})
}
