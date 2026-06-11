import { createGetDeliveryWorkStateQuery } from './get-delivery-work-state'
import { createGetSliceWorkStateQuery } from './get-slice-work-state'
import type { OpenCoreOptions } from '../services'

export type * as GetDeliveryWorkState from './get-delivery-work-state'
export type * as GetSliceWorkState from './get-slice-work-state'

export function createCoreQueries(options: OpenCoreOptions) {
	return {
		getDeliveryWorkState: createGetDeliveryWorkStateQuery(options),
		getSliceWorkState: createGetSliceWorkStateQuery(options),
	}
}

export type Core = ReturnType<typeof createCoreQueries>

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions } = await import('../commands/test-utils')

	describe('Core queries', () => {
		it('returns an object with the expected query keys', () => {
			const queries = createCoreQueries(createTestOpenCoreOptions()) as Record<string, unknown>
			const queryNames = ['getDeliveryWorkState', 'getSliceWorkState']

			expect(Object.keys(queries).sort()).toEqual([...queryNames].sort())
			for (const queryName of queryNames) {
				expect(typeof queries[queryName]).toBe('function')
			}
		})
	})
}
