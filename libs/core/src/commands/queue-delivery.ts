import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { DeliveryActionCommandError } from '../utils/command-errors'
import { deliveryWorkStateMismatch, updateRecordValue, withAuditStampTransaction } from '../utils/command-storage'
import { buildDeliveryContext } from '../utils/delivery-context'
import { getDeliveryState } from '../utils/delivery-context'
import type { Result as CoreResult } from '../utils/types'

const queueDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof queueDeliveryInputPipe>

export type Result = Delivery

export type Error = DeliveryActionCommandError

/** Requires Delivery Work State unqueued; sets Delivery.queued; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createQueueDeliveryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('queueDelivery', queueDeliveryInputPipe, (input, context) => handleQueueDelivery(runtime, input, context))
}

function handleQueueDelivery(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(runtime, context, (storage, stamp) => writeQueueDelivery(storage, input, stamp))
}

async function writeQueueDelivery(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireUnqueuedDelivery(storage, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	return updateRecordValue('delivery', storage, deliveryResult.value.id, { queued: stamp })
}

async function requireUnqueuedDelivery(
	storage: CoreStorage,
	deliveryId: Id,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'unqueued'
		? { ok: true, value: deliveryContext.value.delivery }
		: deliveryWorkStateMismatch(deliveryId, ['unqueued'], deliveryState.value)
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
			seedDelivery(options.tx, 'delivery-1')
			const command = createQueueDeliveryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ deliveryId: ' delivery-1 ', unknown: 'stripped' } as never,
				{
					actor: { type: 'local-user', id: 'actor-1', unknown: 'stripped' },
					correlationId: 'correlation-1',
					unknown: 'stripped',
				} as never,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					...options.tx.deliveries.records.get('delivery-1'),
					queued: localStamp(),
				},
			})
			expect(options.tx.deliveries.records.get('delivery-1')).toEqual(result.ok ? result.value : null)
		})

		it('rejects queueing unless Delivery Work State is unqueued', async () => {
			const options = createTestCoreServices()
			seedDelivery(options.tx, 'delivery-1')
			options.tx.deliveries.records.get('delivery-1')!.queued = localStamp()
			const command = createQueueDeliveryCommand(createTestCoreRuntime(options))

			const result = await command({ deliveryId: 'delivery-1' }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'delivery-work-state-mismatch',
					deliveryId: 'delivery-1',
					expected: ['unqueued'],
					actual: { type: 'needs-artifact-creation' },
				},
			})
		})
	})
}
