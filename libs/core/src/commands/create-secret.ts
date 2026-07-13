import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import { secretValueRefPipe, type Secret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, nextId } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const createSecretInputPipe = v.object({ name: nonEmptyTrimmedStringPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof createSecretInputPipe>

export type Result = Secret

export type Error = InvalidInputError | InvalidCoreServiceOutputError | InvariantViolationError | StorageOperationFailedError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateSecretCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createSecret', createSecretInputPipe, (input, context) => {
		const stamp = auditStamp(runtime.values, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(runtime.values)
		if (!id.ok) return Promise.resolve(id)

		const secret: Secret = {
			id: id.value,
			name: input.name,
			valueRef: input.valueRef,
			created: stamp.value,
			updated: null,
			valueReplaced: null,
			archivePeriods: [],
		}

		return runtime.transactions.run(
			({ storage }): Promise<CoreResult<Secret, Exclude<Error, InvalidInputError>>> => createRecordValue('secret', storage, secret),
		)
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp } = await import('../utils/test-helpers')

	describe('createSecret command', () => {
		it('creates Secrets with protected value references and empty Archive Periods', async () => {
			const options = createTestCoreServices()
			const command = createCreateSecretCommand(createTestCoreRuntime(options))

			const result = await command({ name: '  GitHub token  ', valueRef: ' protected-ref ' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					name: 'GitHub token',
					valueRef: 'protected-ref',
					created: localStamp(),
					updated: null,
					valueReplaced: null,
					archivePeriods: [],
				},
			})
		})
	})
}
