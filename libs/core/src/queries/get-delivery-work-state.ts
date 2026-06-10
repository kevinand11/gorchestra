import { v, type PipeOutput } from 'valleyed'

import { buildQueryStub } from './utils'
import { idPipe } from '../domain/commons'
import type { DeliveryWorkState } from '../domain/delivery'
import type { WorkStateQueryError } from '../errors'
import type { Result as CoreResult } from '../types'

const getDeliveryWorkStateInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof getDeliveryWorkStateInputPipe>
export type Result = DeliveryWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetDeliveryWorkStateQuery(): Operation {
	return buildQueryStub<Result, typeof getDeliveryWorkStateInputPipe>('getDeliveryWorkState', getDeliveryWorkStateInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('getDeliveryWorkState query', () => {
		it('validates input before returning not implemented', async () => {
			const query = createGetDeliveryWorkStateQuery()

			const result = await query({ deliveryId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getDeliveryWorkState' },
			})
		})
	})
}
