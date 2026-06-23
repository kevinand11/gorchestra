import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import type { FetchedFeedback } from '../domain/review-surface'
import type { RevisionGate } from '../domain/revision'
import type { CommandStubError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildStubCommand } from './utils/handler'

const openRevisionGateInputPipe = v.object({ reviewSurfaceId: idPipe })
export type Input = PipeOutput<typeof openRevisionGateInputPipe>

export interface Result {
	revisionGate: RevisionGate

	/** Fetched from current Review Surface; not stored as authoritative Portfolio data. */
	feedback: FetchedFeedback[]
}

export type Error = CommandStubError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createOpenRevisionGateCommand(_runtime: CoreRuntime): Operation {
	return buildStubCommand<Result>('openRevisionGate', openRevisionGateInputPipe)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime } = await import('../utils/test-helpers')

	describe('openRevisionGate command', () => {
		it('validates input before returning not implemented', async () => {
			const command = createOpenRevisionGateCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'openRevisionGate' },
			})
		})
	})
}
