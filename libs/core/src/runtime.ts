import { createCoreProviders, type CoreProviders } from './providers'
import type { CoreServices } from './services'

export interface CoreRuntime {
	services: CoreServices
	providers: CoreProviders
}

export function createCoreRuntime(services: CoreServices): CoreRuntime {
	return { services, providers: createCoreProviders() }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('./utils/test-helpers')

	describe('Core runtime', () => {
		it('wires validated Core Services with internal Core Providers', () => {
			const services = createTestCoreServices()
			const runtime = createCoreRuntime(services)

			expect(runtime.services).toBe(services)
			expect(Object.keys(runtime.providers.sourceControl)).toEqual(['github'])
			expect(Object.keys(runtime.providers.modelProviderProtocols).sort()).toEqual(
				['anthropicMessages', 'googleGenerativeAI', 'openAICompletions', 'openAIResponses'].sort(),
			)
		})
	})
}
