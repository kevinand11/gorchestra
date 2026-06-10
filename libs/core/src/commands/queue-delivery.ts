import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import type { Action } from '../domain/action'
import { idPipe, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../types'

const queueDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof queueDeliveryInputPipe>

export interface Result {
	delivery: Delivery
	action: Action
}

export type Error = CommandStubError

/** Requires Delivery Work State unqueued; records exactly one queue-delivery Action; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createQueueDeliveryCommand(): Operation {
	return buildStubCommand<Result>('queueDelivery', queueDeliveryInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('queueDelivery command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createQueueDeliveryCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'queueDelivery' } })
		})

		it('accepts unknown input and context fields before returning not implemented', async () => {
			const command = createQueueDeliveryCommand()

			const result = await command(
				{ deliveryId: ' delivery-1 ', unknown: 'stripped' } as never,
				{
					actor: { type: 'local-user', id: 'actor-1', unknown: 'stripped' },
					correlationId: null,
					unknown: 'stripped',
				} as never,
			)

			expect(result).toEqual({ ok: false, error: { type: 'not-implemented', operation: 'queueDelivery' } })
		})
	})
}
