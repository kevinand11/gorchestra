import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { WorkContext } from './types'
import { runModelAgentRun } from '../runtime/agent-runs/model-loop'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'
import { buildWorkHandler } from './utils/handler'

const inputPipe = v.object({ agentRunId: idPipe })
type ParsedInput = PipeOutput<typeof inputPipe>
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>
export type Result = void
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createRunModelAgentRunOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('runModelAgentRun', inputPipe, (input: ParsedInput) => runModelAgentRun(runtime, input.agentRunId))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices } = await import('../utils/test-helpers')

	describe('runModelAgentRun work operation', () => {
		it('validates input with the work boundary before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.agentRuns.fail.get = true
			const operation = createRunModelAgentRunOperation(createTestCoreRuntime(options))

			const result = await operation({ agentRunId: '' }, { correlationId: null })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'work', operation: 'runModelAgentRun' },
			})
			expect(options.transactionCalls()).toBe(0)
		})
	})
}
