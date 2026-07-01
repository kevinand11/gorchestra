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

const replaceSecretInputPipe = v.object({ secretId: idPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof replaceSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createReplaceSecretCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('replaceSecret', replaceSecretInputPipe, (input, context) =>
		updateStoredRecordWithAudit(runtime, context, 'secret', input.secretId, (secret, stamp) => ({
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
