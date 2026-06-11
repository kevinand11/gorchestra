import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import type { Action } from '../domain/action'
import { idPipe, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const retryDeliveryPreflightInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof retryDeliveryPreflightInputPipe>

export interface Result {
	delivery: Delivery
	action: Action
}

export type Error = CommandStubError

/**
 * Explicitly retries Delivery preflight for a Delivery whose Delivery Work State
 * is preflight-failed. Records a validate-preflight Action authorized by the
 * OperationContext; a passed retry supersedes the previous failure by ordering.
 */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRetryDeliveryPreflightCommand(): Operation {
	return buildStubCommand<Result>('retryDeliveryPreflight', retryDeliveryPreflightInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('retryDeliveryPreflight command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createRetryDeliveryPreflightCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'retryDeliveryPreflight' },
			})
		})
	})
}
