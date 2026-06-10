import { v, type PipeOutput } from 'valleyed'

import { buildQueryStub } from './utils'
import { idPipe } from '../domain/commons'
import type { SliceWorkState } from '../domain/slice'
import type { WorkStateQueryError } from '../errors'
import type { Result as CoreResult } from '../types'

const getSliceWorkStateInputPipe = v.object({ sliceId: idPipe })
export type Input = PipeOutput<typeof getSliceWorkStateInputPipe>
export type Result = SliceWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSliceWorkStateQuery(): Operation {
	return buildQueryStub<Result, typeof getSliceWorkStateInputPipe>('getSliceWorkState', getSliceWorkStateInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('getSliceWorkState query', () => {
		it('validates input before returning not implemented', async () => {
			const query = createGetSliceWorkStateQuery()

			const result = await query({ sliceId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getSliceWorkState' },
			})
		})
	})
}
