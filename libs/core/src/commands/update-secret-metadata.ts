import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, nonEmptyTrimmedStringPipe } from '../domain/commons'
import { type Secret } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, getRequired, updateRecordValue } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const updateSecretMetadataInputPipe = v.object({ secretId: idPipe, name: nonEmptyTrimmedStringPipe })
export type Input = PipeOutput<typeof updateSecretMetadataInputPipe>

export type Result = Secret

export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| InvariantViolationError
	| StorageOperationFailedError
	| ResourceNotFoundError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateSecretMetadataCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateSecretMetadata', updateSecretMetadataInputPipe, async (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return stamp

		return runtime.transactions.run(async ({ storage }): Promise<CoreResult<Secret, Exclude<Error, InvalidInputError>>> => {
			const existing = await getRequired('secret', storage, input.secretId)
			if (!existing.ok) return existing

			return updateRecordValue('secret', storage, input.secretId, {
				...existing.value,
				name: input.name,
				updated: stamp.value,
			})
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedSecret } = await import('../utils/test-helpers')

	describe('updateSecretMetadata command', () => {
		it('updates Secret metadata and update Audit Stamps', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			const command = createUpdateSecretMetadataCommand(createTestCoreRuntime(options))

			const result = await command({ secretId: '01k00000000000000000000040', name: ' Updated Secret ' }, context)

			expect(result).toMatchObject({
				ok: true,
				value: {
					id: '01k00000000000000000000040',
					name: 'Updated Secret',
					updated: localStamp(),
					valueReplaced: null,
				},
			})
		})
	})
}
