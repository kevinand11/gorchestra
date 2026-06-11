import { v, type PipeOutput } from 'valleyed'

import { auditStamp, getRequired, putRecord, unarchiveRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
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

export function createUnarchiveModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveModel', unarchiveModelInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model', tx.models, input.modelId, modelPipe)
			if (!existing.ok) return existing

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'model', input.modelId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord('model', tx.models, unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel, stamp } = await import('./test-utils')

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
