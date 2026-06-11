import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { updateStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const updateModelInputPipe = v.object({ modelId: idPipe, name: nonEmptyTrimmedStringPipe })
export type Input = PipeOutput<typeof updateModelInputPipe>

export type Result = Model

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectModels = (tx: CoreStorageTransaction) => tx.models

export function createUpdateModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('updateModel', updateModelInputPipe, (input, context) =>
		updateStoredRecordWithAudit(options, context, 'model', selectModels, input.modelId, modelPipe, (model, stamp) => ({
			...model,
			name: input.name,
			updated: stamp,
		})),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel } = await import('../utils/test-helpers')

	describe('updateModel command', () => {
		it('updates only human-readable Model names', async () => {
			const options = createTestOpenCoreOptions()
			seedSelectableModel(options.tx, 'model-1')
			const command = createUpdateModelCommand(options)

			const result = await command({ modelId: 'model-1', name: ' Updated ' }, context)

			expect(result).toMatchObject({ ok: true, value: { id: 'model-1', name: 'Updated', updated: localStamp() } })
		})
	})
}
