import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { secretBindingPipe, type SecretBinding } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	NotArchivedError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { unarchiveStoredRecordWithAudit } from '../utils/command-storage'
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

const selectSecretBindings = (tx: CoreStorageTransaction) => tx.secretBindings

export function createUnarchiveSecretBindingCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('unarchiveSecretBinding', unarchiveSecretBindingInputPipe, (input, context) =>
		unarchiveStoredRecordWithAudit(options, context, 'secret-binding', selectSecretBindings, input.secretBindingId, secretBindingPipe),
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
