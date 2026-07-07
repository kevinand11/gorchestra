import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type Secret } from '../domain/secret'
import type {
	ResourceArchivedError,
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

const archiveSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof archiveSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createArchiveSecretCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('archiveSecret', archiveSecretInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(runtime, context, 'secret', input.secretId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('archiveSecret command', () => {
		it('archives Secrets while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			const command = createArchiveSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: '01k00000000000000000000040' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
