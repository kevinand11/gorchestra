import type { CoreRuntime } from '../runtime'
import { createListProjectsQuery } from './list-projects'

export type * as ListProjects from './list-projects'

export function createCoreQueries(runtime: CoreRuntime) {
	const services = runtime.services

	return {
		listProjects: createListProjectsQuery(services),
	}
}

export type Core = ReturnType<typeof createCoreQueries>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createCoreRuntime } = await import('../runtime')
	const { createTestCoreServices } = await import('../utils/test-helpers')

	describe('Core queries', () => {
		it('returns an object with the expected query keys', () => {
			const queries = createCoreQueries(createCoreRuntime(createTestCoreServices())) as Record<string, unknown>
			const queryNames = ['listProjects']

			expect(Object.keys(queries).sort()).toEqual([...queryNames].sort())
			for (const queryName of queryNames) {
				expect(typeof queries[queryName]).toBe('function')
			}
		})
	})
}
