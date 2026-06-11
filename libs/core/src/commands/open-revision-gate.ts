import { v, type PipeOutput } from 'valleyed'

import { buildStubCommand } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import type { FetchedFeedback } from '../domain/review-surface'
import type { RevisionGate } from '../domain/revision'
import type { CommandStubError } from '../errors'
import type { Result as CoreResult } from '../utils/types'

const openRevisionGateInputPipe = v.object({ reviewSurfaceId: idPipe })
export type Input = PipeOutput<typeof openRevisionGateInputPipe>

export interface Result {
	revisionGate: RevisionGate

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createOpenRevisionGateCommand(): Operation {
	return buildStubCommand<Result>('openRevisionGate', openRevisionGateInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context } = await import('./test-utils')

	describe('openRevisionGate command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createOpenRevisionGateCommand()

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'openRevisionGate' },
			})
		})
	})
}
