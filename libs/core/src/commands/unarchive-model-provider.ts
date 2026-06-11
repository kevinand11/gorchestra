import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { modelProviderPipe, type ModelProvider } from '../domain/model-provider'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { unarchiveStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const unarchiveModelProviderInputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof unarchiveModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectModelProviders = (tx: CoreStorageTransaction) => tx.modelProviders

export function createUnarchiveModelProviderCommand(options: CoreServices): Operation {
	return buildCommandHandler('unarchiveModelProvider', unarchiveModelProviderInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(options, context, 'model-provider', selectModelProviders, input.modelProviderId, modelProviderPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedModelProvider, stamp } = await import('../utils/test-helpers')

	describe('unarchiveModelProvider command', () => {
		it('unarchives Model Providers while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			seedModelProvider(options.tx, 'provider-1', true)
			const command = createUnarchiveModelProviderCommand(options)

			const result = await command({ modelProviderId: 'provider-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
