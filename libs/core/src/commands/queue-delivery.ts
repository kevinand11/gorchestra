import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { exclusiveDeliverySchedulerClaim } from '../dispatch/claims'
import { idPipe } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { DeliveryActionCommandError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, deliveryWorkStateMismatch, updateRecordValue } from '../utils/command-storage'
import { buildDeliveryContext, getDeliveryState } from '../utils/delivery-context'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const queueDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof queueDeliveryInputPipe>

export type Result = Delivery

export type Error = DeliveryActionCommandError

/** Requires Delivery Work State unqueued; sets Delivery.queued; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createQueueDeliveryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('queueDelivery', queueDeliveryInputPipe, async (input, context) => {
		const queued = auditStamp(runtime.values, context)
		if (!queued.ok) return queued

		return runtime.transactions.run<Result, Error>(async ({ storage, dispatch }) => {
			const deliveryContext = await buildDeliveryContext(storage, input.deliveryId)
			if (!deliveryContext.ok) return deliveryContext

			const deliveryState = getDeliveryState(deliveryContext.value)
			if (!deliveryState.ok) return deliveryState
			if (deliveryState.value.type === 'unqueued') {
				const delivery = await updateRecordValue('delivery', storage, deliveryContext.value.delivery.id, { queued: queued.value })
				if (!delivery.ok) return delivery
				const accepted = await dispatch.request({
					payload: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
					reason: { type: 'delivery-work-requested' },
					coordinationClaims: [exclusiveDeliverySchedulerClaim(input.deliveryId)],
					deduplicationKey: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
				})
				return accepted.ok ? delivery : accepted
			}

			return deliveryWorkStateMismatch(input.deliveryId, ['unqueued'], deliveryState.value)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedDelivery } = await import('../utils/test-helpers')

	describe('queueDelivery command', () => {
		it('validates input before reading storage', async () => {
			const command = createQueueDeliveryCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'queueDelivery' } })
		})

		it('sets Delivery.queued when Delivery Work State is unqueued', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			const command = createQueueDeliveryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ deliveryId: ' 01k00000000000000000000008 ', unknown: 'stripped' } as never,
				{
					actor: { type: 'local-user', id: 'actor-1', unknown: 'stripped' } as never,
					correlationId: 'correlation-1',
					unknown: 'stripped',
				} as never,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					...options.tx.deliveries.records.get('01k00000000000000000000008'),
					queued: localStamp(),
				},
			})
			expect(options.tx.deliveries.records.get('01k00000000000000000000008')).toEqual(result.ok ? result.value : null)
			expect([...options.tx.dispatchRequests.records.values()].map((request) => request.payload)).toEqual([
				{ type: 'delivery-work-scheduler', deliveryId: '01k00000000000000000000008' },
			])
		})

		it('rejects queueing unless Delivery Work State is unqueued', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, '01k00000000000000000000008')
			options.tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
			const command = createQueueDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: '01k00000000000000000000008' }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: '01k00000000000000000000008',
					expected: ['unqueued'],
					actual: { type: 'needs-artifact-creation' },
				},
			})
		})
	})
}
