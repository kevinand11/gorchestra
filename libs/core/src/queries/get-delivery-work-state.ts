import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { DeliveryWorkState } from '../domain/delivery'
import type { WorkStateQueryError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from './utils'
import { buildDeliveryContext } from '../utils/delivery-context'
import { getDeliveryState } from '../utils/delivery-context'
import { withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const getDeliveryWorkStateInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof getDeliveryWorkStateInputPipe>
export type Result = DeliveryWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetDeliveryWorkStateQuery(options: CoreServices): Operation {
	return buildQueryHandler('getDeliveryWorkState', getDeliveryWorkStateInputPipe, (input) =>
		withTransaction(options, async (tx) => {
			const context = await buildDeliveryContext(tx, input.deliveryId)
			return context.ok ? getDeliveryState(context.value) : context
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedDelivery, seedProject, seedSecret } = await import('../utils/test-helpers')

	describe('getDeliveryWorkState query', () => {
		it('validates input before reading storage', async () => {
			const query = createGetDeliveryWorkStateQuery(createTestCoreServices())

			const result = await query({ deliveryId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getDeliveryWorkState' },
			})
		})

		it('derives unqueued for an existing Delivery without queue Action', async () => {
			const options = createTestCoreServices()
			seedDeliveryContextTarget(options)
			const query = createGetDeliveryWorkStateQuery(options)

			const result = await query({ deliveryId: 'delivery-1' })

			expect(result).toEqual({ ok: true, value: { type: 'unqueued' } })
		})
	})

	function seedDeliveryContextTarget(options: ReturnType<typeof createTestCoreServices>) {
		seedProject(options.tx, 'project-1')
		seedDelivery(options.tx, 'delivery-1')
		seedSecret(options.tx, 'secret-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
		})
	}
}
