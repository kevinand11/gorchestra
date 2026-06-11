import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import type { CommandStubError } from '../errors'
import { buildStubCommand } from '../utils/command'
import type { Result as CoreResult } from '../utils/types'

const closeRevisionGateInputPipe = v.object({ revisionGateId: idPipe })
export type Input = PipeOutput<typeof closeRevisionGateInputPipe>

export type Result = void

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCloseRevisionGateCommand(): Operation {
	return buildStubCommand<void>('closeRevisionGate', closeRevisionGateInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('../utils/test-helpers')

	describe('closeRevisionGate command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createCloseRevisionGateCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'closeRevisionGate' },
			})
		})
	})
}
