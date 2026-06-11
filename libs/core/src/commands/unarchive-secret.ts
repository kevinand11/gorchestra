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
import type { OpenCoreOptions } from '../services'
import { buildCommandHandler } from '../utils/command'
import { auditStamp, getRequired, putRecord, unarchiveRecord, withTransaction } from '../utils/command-storage'
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

export function createUnarchiveSecretCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('unarchiveSecret', unarchiveSecretInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<Secret, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('secret', tx.secrets, input.secretId, secretPipe)
			if (!existing.ok) return existing

			const unarchived = unarchiveRecord(existing.value, stamp.value, 'secret', input.secretId)
			if (!unarchived.ok) return unarchived

			const stored = await putRecord('secret', tx.secrets, unarchived.value.id, unarchived.value)
			if (!stored.ok) return stored

			return unarchived
		})
	})
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
