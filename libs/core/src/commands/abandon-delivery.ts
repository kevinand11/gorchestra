import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { freeFormStringPipe, idPipe } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildStubCommand } from './utils/handler'

const abandonDeliveryInputPipe = v.object({ deliveryId: idPipe, reason: freeFormStringPipe })
export type Input = PipeOutput<typeof abandonDeliveryInputPipe>

export type Result = Delivery

export type Error = CommandStubError

/** Requires Delivery Work State not closed; sets Delivery.closed after required cleanup evidence is embedded; duplicate calls fail with delivery-work-state-mismatch. */
export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

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
