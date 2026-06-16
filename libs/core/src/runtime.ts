import type { AgentRun } from './domain/agent-run'
import { createCoreProviders, type CoreProviders } from './providers'
import type { CoreServices } from './services'

export interface CoreAgentRunRuntime {
	runExecutionAgentRun(input: { agentRun: AgentRun }): Promise<void>
}

export interface CoreRuntime {
	services: CoreServices
	providers: CoreProviders
	agentRuns: CoreAgentRunRuntime
}

export function createCoreRuntime(services: CoreServices): CoreRuntime {
	return { services, providers: createCoreProviders(services), agentRuns: createDefaultAgentRunRuntime() }
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
		})
	})
}
