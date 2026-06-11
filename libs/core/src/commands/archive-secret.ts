import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { secretPipe, type Secret } from '../domain/secret'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { archiveStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const archiveSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof archiveSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectSecrets = (tx: CoreStorageTransaction) => tx.secrets

export function createArchiveSecretCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('archiveSecret', archiveSecretInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(options, context, 'secret', selectSecrets, input.secretId, secretPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('archiveSecret command', () => {
		it('archives Secrets while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			const command = createArchiveSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: 'secret-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
