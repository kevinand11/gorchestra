import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { unarchiveStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const unarchiveModelInputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof unarchiveModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectModels = (tx: CoreStorageTransaction) => tx.models

export function createUnarchiveModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveModel', unarchiveModelInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(options, context, 'model', selectModels, input.modelId, modelPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel, stamp } = await import('../utils/test-helpers')

	describe('unarchiveModel command', () => {
		it('unarchives Models while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			seedSelectableModel(options.tx, 'model-1', { modelArchived: true })
			const command = createUnarchiveModelCommand(options)

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
