import { v, type PipeOutput } from 'valleyed'

import { auditStamp, getRequired, putRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { secretPipe, secretValueRefPipe, type Secret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const replaceSecretInputPipe = v.object({ secretId: idPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof replaceSecretInputPipe>

export type Result = Secret

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createReplaceSecretCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('replaceSecret', replaceSecretInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		return withTransaction(options, async (tx): Promise<CoreResult<Secret, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('secret', tx.secrets, input.secretId, secretPipe)
			if (!existing.ok) return existing

			const secret: Secret = { ...existing.value, valueRef: input.valueRef, replaced: stamp.value }
			const stored = await putRecord('secret', tx.secrets, secret.id, secret)
			if (!stored.ok) return stored

			return { ok: true, value: secret }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedSecret } = await import('./test-utils')

	describe('replaceSecret command', () => {
		it('replaces Secret protected value references and replacement Audit Stamps', async () => {
			const options = createTestOpenCoreOptions()
			seedSecret(options.tx, 'secret-1')
			const command = createReplaceSecretCommand(options)

			const result = await command({ secretId: 'secret-1', valueRef: ' protected-ref-2 ' }, context)

			expect(result).toMatchObject({ ok: true, value: { id: 'secret-1', valueRef: 'protected-ref-2', replaced: localStamp() } })
		})
	})
}
