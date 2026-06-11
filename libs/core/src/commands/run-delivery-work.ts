import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type Id, type OperationContext } from '../domain/commons'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const runDeliveryWorkInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof runDeliveryWorkInputPipe>

export type Result =
	/** At least one of actionIds or agentRunIds must be non-empty. */
	{ type: 'worked'; actionIds: Id[]; agentRunIds: Id[] } | { type: 'no-op'; reason: RunDeliveryWorkNoOpReason }

export type RunDeliveryWorkNoOpReason =
	| { type: 'no-eligible-work' }
	| { type: 'slice-capacity-full'; activeSlots: number; maxActiveSliceSlots: number }
	| { type: 'claim-conflict'; work: RunDeliveryWorkClaimConflictWork }
	| { type: 'no-observed-change'; observed: RunDeliveryWorkNoObservedChangeTarget }

export type RunDeliveryWorkClaimConflictWork = { type: 'delivery' } | { type: 'slice'; sliceId: Id }

export type RunDeliveryWorkNoObservedChangeTarget =
	| { type: 'slice-review-surface'; sliceId: Id; reviewSurfaceId: Id }
	| { type: 'delivery-review-surface'; reviewSurfaceId: Id }

export type Error = CommandStubError

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

export function createRunDeliveryWorkCommand(): Operation {
	return buildStubCommand<Result>('runDeliveryWork', runDeliveryWorkInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('runDeliveryWork command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createRunDeliveryWorkCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({ ok: false, error: { type: 'invalid-input', boundary: 'command', operation: 'runDeliveryWork' } })
		})
	})
}
