import { v, type PipeOutput } from 'valleyed'

import { auditStamp, getRequired, putRecord, unarchiveRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { secretBindingPipe, type SecretBinding } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const unarchiveSecretBindingInputPipe = v.object({ secretBindingId: idPipe })
export type Input = PipeOutput<typeof unarchiveSecretBindingInputPipe>

export type Result = SecretBinding

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveSecretBindingCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveSecretBinding', unarchiveSecretBindingInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<SecretBinding, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('secret-binding', tx.secretBindings, input.secretBindingId, secretBindingPipe)
			if (!existing.ok) return existing

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'secret-binding', input.secretBindingId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord('secret-binding', tx.secretBindings, unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret, stamp } = await import('./test-utils')

	describe('unarchiveSecretBinding command', () => {
		it('unarchives Secret Bindings while preserving history', async () => {
			const options = createTestOpenCoreOptions()
			seedSecret(options.tx, 'secret-1')
			options.tx.secretBindings.records.set('binding-1', {
				id: 'binding-1',
				secretId: 'secret-1',
				scope: { type: 'portfolio' },
				envName: 'TOKEN',
				created: stamp,
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const command = createUnarchiveSecretBindingCommand(options)

			const result = await command({ secretBindingId: 'binding-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
