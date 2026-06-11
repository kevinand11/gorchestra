import type { CoreRuntime } from '../runtime'
import { createGetDeliveryWorkStateQuery } from './get-delivery-work-state'
import { createGetSliceWorkStateQuery } from './get-slice-work-state'

export type * as GetDeliveryWorkState from './get-delivery-work-state'
export type * as GetSliceWorkState from './get-slice-work-state'

export function createCoreQueries(runtime: CoreRuntime) {
	const services = runtime.services

	return {
		getDeliveryWorkState: createGetDeliveryWorkStateQuery(services),
		getSliceWorkState: createGetSliceWorkStateQuery(services),
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
			const queryNames = ['getDeliveryWorkState', 'getSliceWorkState']

			expect(Object.keys(queries).sort()).toEqual([...queryNames].sort())
			for (const queryName of queryNames) {
				expect(typeof queries[queryName]).toBe('function')
			}
		})
	})
}
