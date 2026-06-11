import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { secretPipe, secretValueRefPipe, type Secret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { updateStoredRecordWithAudit } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const replaceSecretInputPipe = v.object({ secretId: idPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof replaceSecretInputPipe>

export type Result = Secret

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError | ResourceNotFoundError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

const selectSecrets = (tx: CoreStorageTransaction) => tx.secrets

export function createReplaceSecretCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('replaceSecret', replaceSecretInputPipe, (input, context) =>
		updateStoredRecordWithAudit(options, context, 'secret', selectSecrets, input.secretId, secretPipe, (secret, stamp) => ({
			...secret,
			valueRef: input.valueRef,
			replaced: stamp,
		})),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('replaceSecret command', () => {
		it('replaces Secret protected value references and replacement Audit Stamps', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			const command = createReplaceSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: 'secret-1', valueRef: ' protected-ref-2 ' }, context)

			expect(result).toMatchObject({ ok: true, value: { id: 'secret-1', valueRef: 'protected-ref-2', replaced: localStamp() } })
		})
	})
}
