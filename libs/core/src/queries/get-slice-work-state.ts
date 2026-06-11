import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { SliceWorkState } from '../domain/slice'
import type { WorkStateQueryError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from './utils'
import { withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'
import { deriveSliceWorkState } from '../utils/work-state'

const getSliceWorkStateInputPipe = v.object({ sliceId: idPipe })
export type Input = PipeOutput<typeof getSliceWorkStateInputPipe>
export type Result = SliceWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSliceWorkStateQuery(options: CoreServices): Operation {
	return buildQueryHandler('getSliceWorkState', getSliceWorkStateInputPipe, (input) =>
		withTransaction(options, (tx) => deriveSliceWorkState(tx, input.sliceId)),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions, seedDelivery, seedSlice } = await import('../utils/test-helpers')

	describe('getSliceWorkState query', () => {
		it('validates input before reading storage', async () => {
			const query = createGetSliceWorkStateQuery(createTestOpenCoreOptions())

			const result = await query({ sliceId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getSliceWorkState' },
			})
		})

		it('derives needs-artifact-creation for an unblocked Slice without a Slice Artifact', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			const query = createGetSliceWorkStateQuery(options)

			const result = await query({ sliceId: 'slice-1' })

			expect(result).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})
	})
}
