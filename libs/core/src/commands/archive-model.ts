import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { modelPipe, type Model } from '../domain/model'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { archiveRecord, auditStamp, getRequired, putRecord, withTransaction } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const archiveModelInputPipe = v.object({ modelId: idPipe })
export type Input = PipeOutput<typeof archiveModelInputPipe>

export type Result = Model

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createArchiveModelCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('archiveModel', archiveModelInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<Model, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('model', tx.models, input.modelId, modelPipe)
			if (!existing.ok) return existing

			const archived = archiveRecord(existing.value, stamp.value, 'model', input.modelId)
			if (!archived.ok) return archived

			const stored = await putRecord('model', tx.models, archived.value.id, archived.value)
			if (!stored.ok) return stored

			return archived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSelectableModel } = await import('../utils/test-helpers')

	describe('archiveModel command', () => {
		it('archives Models while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			seedSelectableModel(options.tx, 'model-1')
			const command = createArchiveModelCommand(options)

			const result = await command({ modelId: 'model-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
