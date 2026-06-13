import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { InvalidInputError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { DeliveryActionCommandError } from '../utils/command-errors'
import { deliveryWorkStateMismatch, putRecordValue, withAuditStampTransaction } from '../utils/command-storage'
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
	const options = runtime.services
	return buildCommandHandler('queueDelivery', queueDeliveryInputPipe, (input, context) => handleQueueDelivery(options, input, context))
}

function handleQueueDelivery(
	options: CoreServices,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withAuditStampTransaction(options, context, (tx, stamp) => writeQueueDelivery(tx, input, stamp))
}

async function writeQueueDelivery(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireUnqueuedDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	return putRecordValue('delivery', tx.deliveries, queueDelivery(deliveryResult.value, stamp))
}

async function requireUnqueuedDelivery(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<CoreResult<Delivery, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(tx, deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const deliveryState = getDeliveryState(deliveryContext.value)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.type === 'unqueued'
		? { ok: true, value: deliveryContext.value.delivery }
		: deliveryWorkStateMismatch(deliveryId, ['unqueued'], deliveryState.value)
}

function queueDelivery(delivery: Delivery, stamp: AuditStamp): Delivery {
	return { ...delivery, queued: stamp }
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
