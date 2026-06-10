import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import type { Action } from '../domain/action'
import { idPipe, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../types'

const shipDeliveryInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof shipDeliveryInputPipe>

export interface Result {
	delivery: Delivery
	action: Action
}

export type Error = CommandStubError

/** Requires Delivery Work State ready-to-ship; records exactly one ship-delivery Action without post-merge validation in v1; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createShipDeliveryCommand(): Operation {
	return buildStubCommand<Result>('shipDelivery', shipDeliveryInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('shipDelivery command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createShipDeliveryCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'shipDelivery' } })
		})
	})
}
