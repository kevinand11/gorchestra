import { v, type PipeOutput } from 'valleyed'

import type { Action } from '../domain/action'
import { freeFormStringPipe, idPipe, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildStubCommand } from '../utils/command'
import type { Result as CoreResult } from '../utils/types'

const abandonDeliveryInputPipe = v.object({ deliveryId: idPipe, reason: freeFormStringPipe })
export type Input = PipeOutput<typeof abandonDeliveryInputPipe>

export interface Result {
	delivery: Delivery
	action: Action
}

export type Error = CommandStubError

/** Requires Delivery Work State not closed; records exactly one abandon-delivery Action after required cleanup evidence is embedded; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAbandonDeliveryCommand(_runtime: CoreRuntime): Operation {
	return buildStubCommand<Result>('abandonDelivery', abandonDeliveryInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime } = await import('../utils/test-helpers')

	describe('abandonDelivery command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createAbandonDeliveryCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'abandonDelivery' } })
		})
	})
}
