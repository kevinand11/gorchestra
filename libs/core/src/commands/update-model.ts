import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { updateStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const updateModelInputPipe = v.object({ modelId: idPipe, name: nonEmptyTrimmedStringPipe })
export type Input = PipeOutput<typeof updateModelInputPipe>

export type Result = Model

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectModels = (tx: CoreStorageTransaction) => tx.models

export function createUpdateModelCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
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
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSelectableModel } =
		await import('../utils/test-helpers')

	describe('updateModel command', () => {
		it('updates only human-readable Model names', async () => {
			const options = createTestCoreServices()
			seedSelectableModel(options.tx, 'model-1')
			const command = createUpdateModelCommand(createTestCoreRuntime(options))

			const result = await command({ modelId: 'model-1', name: ' Updated ' }, context)

			expect(result).toMatchObject({ ok: true, value: { id: 'model-1', name: 'Updated', updated: localStamp() } })
		})
	})
}
