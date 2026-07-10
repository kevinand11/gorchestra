import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type Secret } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { unarchiveStoredRecordWithAudit } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const unarchiveSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof unarchiveSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| ResourceNotArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveSecretCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('unarchiveSecret', unarchiveSecretInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(runtime, context, 'secret', input.secretId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('unarchiveSecret command', () => {
		it('unarchives Secrets while preserving Archive Period history', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040', true)
			const command = createUnarchiveSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: '01k00000000000000000000040' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
