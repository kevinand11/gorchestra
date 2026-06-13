import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { SliceWorkState } from '../domain/slice'
import type { WorkStateQueryError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from './utils'
import { buildDeliveryContext } from '../utils/delivery-context'
import { getSliceState } from '../utils/delivery-context'
import { withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const getSliceWorkStateInputPipe = v.object({ deliveryId: idPipe, sliceId: idPipe })
export type Input = PipeOutput<typeof getSliceWorkStateInputPipe>
export type Result = SliceWorkState
export type Error = WorkStateQueryError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSliceWorkStateQuery(options: CoreServices): Operation {
	return buildQueryHandler('getSliceWorkState', getSliceWorkStateInputPipe, (input) =>
		withTransaction(options, async (tx) => {
			const context = await buildDeliveryContext(tx, input.deliveryId)
			return context.ok ? getSliceState(context.value, input.sliceId) : context
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedDelivery, seedProject, seedSecret, seedSlice } = await import('../utils/test-helpers')

	describe('getSliceWorkState query', () => {
		it('validates input before reading storage', async () => {
			const query = createGetSliceWorkStateQuery(createTestCoreServices())

			const result = await query({ deliveryId: 'delivery-1', sliceId: '   ' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getSliceWorkState' },
			})
		})

		it('derives needs-artifact-creation for an unblocked Slice without a Slice Artifact', async () => {
			const options = createTestCoreServices()
			seedDeliveryContextTarget(options, 'delivery-1')
			seedSlice(options.tx, 'slice-1', 'delivery-1')
			const query = createGetSliceWorkStateQuery(options)

			const result = await query({ deliveryId: 'delivery-1', sliceId: 'slice-1' })

			expect(result).toEqual({ ok: true, value: { type: 'needs-artifact-creation' } })
		})

		it('returns not-found when the Slice is outside the requested Delivery', async () => {
			const options = createTestCoreServices()
			seedDeliveryContextTarget(options, 'delivery-1')
			seedDelivery(options.tx, 'delivery-2')
			seedSlice(options.tx, 'slice-1', 'delivery-2')
			const query = createGetSliceWorkStateQuery(options)

			const result = await query({ deliveryId: 'delivery-1', sliceId: 'slice-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'slice', id: 'slice-1' } })
		})
	})

	function seedDeliveryContextTarget(options: ReturnType<typeof createTestCoreServices>, deliveryId: string) {
		seedProject(options.tx, 'project-1')
		seedDelivery(options.tx, deliveryId)
		seedSecret(options.tx, 'secret-1')
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
		})
	}
}
