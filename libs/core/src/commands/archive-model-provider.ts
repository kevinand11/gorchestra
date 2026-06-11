import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { modelProviderPipe, type ModelProvider } from '../domain/model-provider'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { archiveStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const archiveModelProviderInputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof archiveModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectModelProviders = (tx: CoreStorageTransaction) => tx.modelProviders

export function createArchiveModelProviderCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('archiveModelProvider', archiveModelProviderInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(options, context, 'model-provider', selectModelProviders, input.modelProviderId, modelProviderPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedModelProvider } = await import('../utils/test-helpers')

	describe('archiveModelProvider command', () => {
		it('archives Model Providers while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			seedModelProvider(options.tx, 'provider-1')
			const command = createArchiveModelProviderCommand(options)

			const result = await command({ modelProviderId: 'provider-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
