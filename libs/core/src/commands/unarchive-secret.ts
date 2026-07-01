import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type Secret } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { Result as CoreResult } from '../utils/types'
import { buildCommandHandler } from './utils/handler'
import { unarchiveStoredRecordWithAudit } from './utils/storage'

const unarchiveSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof unarchiveSecretInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

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
			seedSecret(options.tx, 'secret-1', true)
			const command = createUnarchiveSecretCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: 'secret-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
