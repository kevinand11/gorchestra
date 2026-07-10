import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type ModelProvider } from '../domain/model-provider'
import type {
	ResourceArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { archiveStoredRecordWithAudit } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const archiveModelProviderInputPipe = v.object({ modelProviderId: idPipe })
export type Input = PipeOutput<typeof archiveModelProviderInputPipe>

export type Result = ModelProvider

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createArchiveModelProviderCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveModelProvider', archiveModelProviderInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(runtime, context, 'model-provider', input.modelProviderId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedModelProvider } = await import('../utils/test-helpers')

	describe('archiveModelProvider command', () => {
		it('archives Model Providers while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedModelProvider(options.tx, '01k00000000000000000000032')
			const command = createArchiveModelProviderCommand(createTestCoreRuntime(options))

			const result = await command({ modelProviderId: '01k00000000000000000000032' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
