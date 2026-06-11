import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import type { InvalidInputError } from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { DeliveryActionCommandError } from '../utils/command-errors'
import {
	type DeliveryActionCommandResult,
	deliveryWorkStateMismatch,
	prepareAuthorizedAction,
	putRecord,
	readDeliveryWorkState,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const queueDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof queueDeliveryInputPipe>

export type Result = DeliveryActionCommandResult

export type Error = DeliveryActionCommandError

/** Requires Delivery Work State unqueued; records exactly one queue-delivery Action; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createQueueDeliveryCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('queueDelivery', queueDeliveryInputPipe, (input, context) => handleQueueDelivery(options, input, context))
}

async function handleQueueDelivery(
	options: OpenCoreOptions,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const authorizedAction = prepareAuthorizedAction(options, context)
	if (!authorizedAction.ok) return authorizedAction

	return withTransaction(options, (tx) => writeQueueDelivery(tx, input, authorizedAction.value.stamp, authorizedAction.value.actionId))
}

async function writeQueueDelivery(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	actionId: Id,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const deliveryResult = await requireUnqueuedDelivery(tx, input.deliveryId)
	if (!deliveryResult.ok) return deliveryResult

	const action = queueDeliveryAction(input.deliveryId, stamp, actionId)
	const putResult = await putRecord('action', tx.actions, action.id, action)
	if (!putResult.ok) return putResult

	return { ok: true, value: { delivery: deliveryResult.value, action } }
}

async function requireUnqueuedDelivery(
	tx: CoreStorageTransaction,
	deliveryId: Id,
): Promise<CoreResult<Result['delivery'], Exclude<Error, InvalidInputError>>> {
	const deliveryState = await readDeliveryWorkState(tx, deliveryId)
	if (!deliveryState.ok) return deliveryState

	return deliveryState.value.state.type === 'unqueued'
		? { ok: true, value: deliveryState.value.delivery }
		: deliveryWorkStateMismatch(deliveryId, ['unqueued'], deliveryState.value.state)
}

function queueDeliveryAction(deliveryId: Id, stamp: AuditStamp, actionId: Id): Result['action'] {
	return {
		id: actionId,
		deliveryId,
		performed: { at: stamp.at },
		authorized: stamp,
		result: { type: 'queue-delivery' },
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedDelivery } = await import('../utils/test-helpers')

	describe('queueDelivery command', () => {
		it('validates input before reading storage', async () => {
			const command = createQueueDeliveryCommand(createTestOpenCoreOptions())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'queueDelivery' } })
		})

		it('records an authorized queue-delivery Action when Delivery Work State is unqueued', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			const command = createQueueDeliveryCommand(options)

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
					delivery: options.tx.deliveries.records.get('delivery-1'),
					action: {
						id: 'action-1',
						deliveryId: 'delivery-1',
						performed: { at: '2026-06-10T12:00:00.000Z' },
						authorized: localStamp(),
						result: { type: 'queue-delivery' },
					},
				},
			})
			expect(options.tx.actions.records.get('action-1')).toEqual(result.ok ? result.value.action : null)
		})

		it('rejects queueing unless Delivery Work State is unqueued', async () => {
			const options = createTestOpenCoreOptions()
			seedDelivery(options.tx, 'delivery-1')
			options.tx.actions.records.set('action-existing', {
				id: 'action-existing',
				deliveryId: 'delivery-1',
				performed: { at: '2026-06-10T11:00:00.000Z' },
				authorized: localStamp(),
				result: { type: 'queue-delivery' },
			})
			const command = createQueueDeliveryCommand(options)

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
