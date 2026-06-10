import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../types'

const preflightRepositoryInputPipe = v.object({ repositoryId: idPipe })
export type Input = PipeOutput<typeof preflightRepositoryInputPipe>

export type Result = ValidationEvidence

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createPreflightRepositoryCommand(): Operation {
	return buildStubCommand<ValidationEvidence>('preflightRepository', preflightRepositoryInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('preflightRepository command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createPreflightRepositoryCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'preflightRepository' },
			})
		})
	})
}
