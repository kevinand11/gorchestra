import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import type { CommandStubError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildStubCommand } from './utils/handler'

const rejectPlanOutputInputPipe = v.object({ planId: idPipe })
export type Input = PipeOutput<typeof rejectPlanOutputInputPipe>

export type Result = void

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createRejectPlanOutputCommand(_runtime: CoreRuntime): Operation {
	return buildStubCommand<void>('rejectPlanOutput', rejectPlanOutputInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime } = await import('../utils/test-helpers')

	describe('rejectPlanOutput command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createRejectPlanOutputCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'rejectPlanOutput' },
			})
		})
	})
}
