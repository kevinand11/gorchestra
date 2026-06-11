import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { secretBindingPipe, type SecretBinding } from '../domain/secret'
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

const archiveSecretBindingInputPipe = v.object({ secretBindingId: idPipe })
export type Input = PipeOutput<typeof archiveSecretBindingInputPipe>

export type Result = SecretBinding

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| AlreadyArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectSecretBindings = (tx: CoreStorageTransaction) => tx.secretBindings

export function createArchiveSecretBindingCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('archiveSecretBinding', archiveSecretBindingInputPipe, (input, context) =>
		archiveStoredRecordWithAudit(options, context, 'secret-binding', selectSecretBindings, input.secretBindingId, secretBindingPipe),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('archiveSecretBinding command', () => {
		it('archives Secret Bindings while preserving history without cascading Secret archives', async () => {
			const options = createTestOpenCoreOptions()
			seedSecret(options.tx, 'secret-1')
			options.tx.secretBindings.records.set('binding-1', {
				id: 'binding-1',
				secretId: 'secret-1',
				scope: { type: 'portfolio' },
				envName: 'TOKEN',
				created: localStamp(),
				archivePeriods: [],
			})
			const command = createArchiveSecretBindingCommand(options)

			const result = await command({ secretBindingId: 'binding-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: localStamp(), unarchived: null }] } })
		})
	})
}
