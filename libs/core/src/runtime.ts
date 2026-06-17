import type { AgentRun } from './domain/agent-run'
import { createCoreProviders, type CoreProviders } from './providers'
import type { CoreServices } from './services'
import { defaultCoreRuntimeValues, type CoreRuntimeValues } from './utils/runtime-values'

export interface CoreAgentRunRuntime {
	runExecutionAgentRun(input: { agentRun: AgentRun }): Promise<void>
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
	return {
		services,
		providers: overrides.providers ?? createCoreProviders(services),
		agentRuns: overrides.agentRuns ?? createDefaultAgentRunRuntime(),
		values: overrides.values ?? defaultCoreRuntimeValues(),
	}
}

function createDefaultAgentRunRuntime(): CoreAgentRunRuntime {
	return { runExecutionAgentRun: () => Promise.resolve() }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('./utils/test-helpers')

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
			expect(Object.keys(runtime.providers.modelProviderProtocols)).toEqual(['preflightModel'])
			expect(typeof runtime.agentRuns.runExecutionAgentRun).toBe('function')
			expect(typeof runtime.values.nextId).toBe('function')
			expect(typeof runtime.values.now).toBe('function')
		})
	})
}
