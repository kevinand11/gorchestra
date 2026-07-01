import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { type SecretBinding } from '../domain/secret'
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

const unarchiveSecretBindingInputPipe = v.object({ secretBindingId: idPipe })
export type Input = PipeOutput<typeof unarchiveSecretBindingInputPipe>

export type Result = SecretBinding

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| NotArchivedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUnarchiveSecretBindingCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('unarchiveSecretBinding', unarchiveSecretBindingInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(runtime, context, 'secret-binding', input.secretBindingId),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('unarchiveSecretBinding command', () => {
		it('unarchives Secret Bindings while preserving history', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			options.tx.secretBindings.records.set('binding-1', {
				id: 'binding-1',
				secretId: 'secret-1',
				scope: { type: 'portfolio' },
				envName: 'TOKEN',
				created: stamp,
				archivePeriods: [{ archived: stamp, unarchived: null }],
			})
			const command = createUnarchiveSecretBindingCommand(createTestCoreRuntime(options))

			const result = await command({ secretBindingId: 'binding-1' }, context)

			expect(result).toMatchObject({ ok: true, value: { archivePeriods: [{ archived: stamp, unarchived: localStamp() }] } })
		})
	})
}
