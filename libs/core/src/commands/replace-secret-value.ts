import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { secretValueRefPipe, type Secret } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { updateStoredRecordWithAudit } from './utils/storage'

const replaceSecretValueInputPipe = v.object({ secretId: idPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof replaceSecretValueInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createReplaceSecretValueCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('replaceSecretValue', replaceSecretValueInputPipe, (input, context) =>
		updateStoredRecordWithAudit(runtime, context, 'secret', input.secretId, (secret, stamp) => ({
			...secret,
			valueRef: input.valueRef,
			valueReplaced: stamp,
		})),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('replaceSecretValue command', () => {
		it('replaces Secret protected value references and value replacement Audit Stamps', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			const command = createReplaceSecretValueCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: '01k00000000000000000000040', valueRef: ' protected-ref-2 ' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: { id: '01k00000000000000000000040', valueRef: 'protected-ref-2', updated: null, valueReplaced: localStamp() },
			})
		})
	})
}
