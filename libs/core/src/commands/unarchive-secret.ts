import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { secretPipe, type Secret } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { unarchiveStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const unarchiveSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof unarchiveSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectSecrets = (tx: CoreStorageTransaction) => tx.secrets

export function createUnarchiveSecretCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveSecret', unarchiveSecretInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(options, context, 'secret', selectSecrets, input.secretId, secretPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('unarchiveSecret command', () => {
		it('unarchives Secrets while preserving Archive Period history', async () => {
			const options = createTestOpenCoreOptions()
			seedSecret(options.tx, 'secret-1', true)
			const command = createUnarchiveSecretCommand(options)

			const result = await command({ secretId: 'secret-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
