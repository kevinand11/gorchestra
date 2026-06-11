import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { DeliveryWorkState } from '../domain/delivery'
import type { WorkStateQueryError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from './utils'
import { withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'
import { deriveDeliveryWorkState } from '../utils/work-state'

const getDeliveryWorkStateInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof getDeliveryWorkStateInputPipe>
export type Result = DeliveryWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetDeliveryWorkStateQuery(options: CoreServices): Operation {
	return buildQueryHandler('getDeliveryWorkState', getDeliveryWorkStateInputPipe, (input) =>
		withTransaction(options, (tx) => deriveDeliveryWorkState(tx, input.deliveryId)),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestOpenCoreOptions, seedDelivery } = await import('../utils/test-helpers')

	describe('getDeliveryWorkState query', () => {
		it('validates input before reading storage', async () => {
			const query = createGetDeliveryWorkStateQuery(createTestOpenCoreOptions())

			const result = await query({ deliveryId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getDeliveryWorkState' },
			})
		})

		it('derives unqueued for an existing Delivery without queue Action', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			const query = createGetDeliveryWorkStateQuery(options)

			const result = await query({ deliveryId: 'delivery-1' })

			expect(result).toEqual({ ok: true, value: { type: 'unqueued' } })
		})
	})
}
