import { v, type PipeOutput } from 'valleyed'

import { archiveRecord, auditStamp, getRequired, putRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { secretBindingPipe, type SecretBinding } from '../domain/secret'
import type {
	AlreadyArchivedError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
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

export function createArchiveSecretBindingCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('archiveSecretBinding', archiveSecretBindingInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<SecretBinding, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('secret-binding', tx.secretBindings, input.secretBindingId, secretBindingPipe)
			if (!existing.ok) return existing

			const archived = archiveRecord(existing.value, stamp.value, 'secret-binding', input.secretBindingId)
			if (!archived.ok) return archived

			const stored = await putRecord('secret-binding', tx.secretBindings, archived.value.id, archived.value)
			if (!stored.ok) return stored

			return archived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret } = await import('./test-utils')

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
