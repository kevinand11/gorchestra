import { v, type PipeOutput } from 'valleyed'

import { auditStamp, getRequired, putRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const updateModelInputPipe = v.object({ modelId: idPipe, name: nonEmptyTrimmedStringPipe })
export type Input = PipeOutput<typeof updateModelInputPipe>

export type Result = Model

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUpdateModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('updateModel', updateModelInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model', tx.models, input.modelId, modelPipe)
			if (!existing.ok) return existing

			const model: Model = { ...existing.value, name: input.name, updated: stamp.value }
			const stored = await putRecord('model', tx.models, model.id, model)
			if (!stored.ok) return stored

			return { ok: true, value: model }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel } = await import('./test-utils')

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
