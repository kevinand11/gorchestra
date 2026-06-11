import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import type { Revision } from '../domain/revision'
import { revisionOutputProposalPipe } from '../domain/revision'
import type { CommandStubError } from '../errors'
import type { CoreRuntime } from '../runtime'
import { buildStubCommand } from '../utils/command'
import type { Result as CoreResult } from '../utils/types'

const acceptRevisionOutputInputPipe = v.object({ revisionGateId: idPipe, output: revisionOutputProposalPipe })
export type Input = PipeOutput<typeof acceptRevisionOutputInputPipe>

export interface Result {
	revision: Revision
}

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAcceptRevisionOutputCommand(_runtime: CoreRuntime): Operation {
	return buildStubCommand<Result>('acceptRevisionOutput', acceptRevisionOutputInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime } = await import('../utils/test-helpers')

	describe('acceptRevisionOutput command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createAcceptRevisionOutputCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptRevisionOutput' },
			})
		})
	})
}
