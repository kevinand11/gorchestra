import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import type { Delivery } from '../domain/delivery'
import type { Link } from '../domain/graph'
import type { Memory } from '../domain/memory'
import { planOutputProposalPipe } from '../domain/plan'
import type { Slice } from '../domain/slice'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const acceptPlanOutputInputPipe = v.object({ planId: idPipe, output: planOutputProposalPipe })
export type Input = PipeOutput<typeof acceptPlanOutputInputPipe>

export interface Result {
	deliveries: Delivery[]
	slices: Slice[]
	memories: Memory[]
	links: Link[]
}

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAcceptPlanOutputCommand(): Operation {
	return buildStubCommand<Result>('acceptPlanOutput', acceptPlanOutputInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('acceptPlanOutput command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createAcceptPlanOutputCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptPlanOutput' },
			})
		})
	})
}
