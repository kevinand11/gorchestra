import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type Model } from '../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { unarchiveStoredRecordWithAudit } from './utils/storage'

const unarchiveModelInputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof unarchiveModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('unarchiveModel', unarchiveModelInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(runtime, context, 'model', input.modelId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel, stamp } =
		await import('../utils/test-helpers')

	describe('unarchiveModel command', () => {
		it('unarchives Models while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, '01k00000000000000000000024', { modelArchived: true })
			const command = createUnarchiveModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: '01k00000000000000000000024' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
