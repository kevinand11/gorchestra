import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { revisionOutputProposalPipe } from '../domain/revision'
import type { Revision } from '../domain/revision'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const acceptRevisionOutputInputPipe = v.object({ revisionGateId: idPipe, output: revisionOutputProposalPipe })
export type Input = PipeOutput<typeof acceptRevisionOutputInputPipe>

export interface Result {
	revision: Revision
}

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createAcceptRevisionOutputCommand(): Operation {
	return buildStubCommand<Result>('acceptRevisionOutput', acceptRevisionOutputInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('acceptRevisionOutput command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createAcceptRevisionOutputCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'acceptRevisionOutput' },
			})
		})
	})
}
