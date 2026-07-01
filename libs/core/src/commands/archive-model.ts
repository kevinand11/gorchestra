import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type Model } from '../domain/model'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { archiveStoredRecordWithAudit } from './utils/storage'

const archiveModelInputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof archiveModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createArchiveModelCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveModel', archiveModelInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(runtime, context, 'model', input.modelId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('archiveModel command', () => {
		it('archives Models while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const command = createArchiveModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
