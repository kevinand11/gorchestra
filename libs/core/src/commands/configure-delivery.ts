import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { deliveryConfigPipe } from '../domain/config'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const configureDeliveryInputPipe = v.object({ deliveryId: idPipe, config: deliveryConfigPipe })
export type Input = PipeOutput<typeof configureDeliveryInputPipe>

export type Result = Delivery

export type Error = CommandStubError

/** Requires Delivery Work State not closed. Does not clear preflight-failed. */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createConfigureDeliveryCommand(): Operation {
	return buildStubCommand<Delivery>('configureDelivery', configureDeliveryInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('configureDelivery command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createConfigureDeliveryCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'configureDelivery' },
			})
		})
	})
}
