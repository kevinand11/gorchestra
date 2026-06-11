import { v, type PipeOutput } from 'valleyed'

import { handleDeliveryWorkState } from './handlers'
import type { Error, Result } from './types'
import { idPipe, type OperationContext } from '../../domain/commons'
import { deliveryPipe } from '../../domain/delivery'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import type { CoreServices } from '../../services'
import { buildCommandHandler } from '../../utils/command'
import { getRequired, withTransaction } from '../../utils/storage'
import type { Result as CoreResult } from '../../utils/types'
import { deriveDeliveryWorkState } from '../../utils/work-state'

export type {
	Error,
	Result,
	RunDeliveryWorkClaimConflictWork,
	RunDeliveryWorkNoObservedChangeTarget,
	RunDeliveryWorkNoOpReason,
} from './types'

const runDeliveryWorkInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof runDeliveryWorkInputPipe>

/**
 * Performs one bounded scheduler step for one available processing slot. It does
 * not wait for Agent Runs, review, human input, or other asynchronous external
 * state. Delivery preflight runs before every bounded scheduler pass.
 * Successful external operations that change or observe authoritative Delivery
 * state produce Actions; failed external operations that produce evidence are
 * recorded as failure Actions. Scheduling loops should skip non-schedulable
 * Deliveries and refetch Delivery/Slice state before each pass.
 */
export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRunDeliveryWorkCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('runDeliveryWork', runDeliveryWorkInputPipe, (input) => handleRunDeliveryWork(options, input))
}

async function handleRunDeliveryWork(options: CoreServices, input: Input): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return withTransaction(options, async (tx) => {
		const deliveryResult = await getRequired('delivery', tx.deliveries, input.deliveryId, deliveryPipe)
		if (!deliveryResult.ok) return deliveryResult

		const stateResult = await deriveDeliveryWorkState(tx, input.deliveryId)
		if (!stateResult.ok) return stateResult

		return handleDeliveryWorkState({ options, tx, delivery: deliveryResult.value }, stateResult.value)
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices } = await import('../../utils/test-helpers')

	describe('runDeliveryWork command', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			const command = createRunDeliveryWorkCommand(createTestCoreRuntime(options))

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'runDeliveryWork' } })
			expect(options.transactionCalls()).toBe(0)
		})
	})
}
