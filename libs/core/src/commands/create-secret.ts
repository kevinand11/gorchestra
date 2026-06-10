import { v, type PipeOutput } from 'valleyed'

import { auditStamp, nextId, putRecord, withTransaction } from './storage-utils'
import { buildCommandHandler } from './utils'
import { nonEmptyTrimmedStringPipe, type OperationContext } from '../domain/commons'
import { secretValueRefPipe, type Secret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const createSecretInputPipe = v.object({ name: nonEmptyTrimmedStringPipe, valueRef: secretValueRefPipe })
export type Input = PipeOutput<typeof createSecretInputPipe>

export type Result = Secret

export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateSecretCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createSecret', createSecretInputPipe, (input, context) => {
		const stamp = auditStamp(options, context)
		if (!stamp.ok) return Promise.resolve(stamp)

		const id = nextId(options, 'secret')
		if (!id.ok) return Promise.resolve(id)

		const secret: Secret = {
			id: id.value,
			name: input.name,
			valueRef: input.valueRef,
			created: stamp.value,
			replaced: null,
			archivePeriods: [],
		}

		return withTransaction(options, async (tx): Promise<CoreResult<Secret, Exclude<Error, InvalidInputError>>> => {
			const stored = await putRecord('secret', tx.secrets, id.value, secret)
			if (!stored.ok) return stored

			return { ok: true, value: secret }
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp } = await import('./test-utils')

	describe('createSecret command', () => {
		it('creates Secrets with protected value references and empty Archive Periods', async () => {
			const options = createTestOpenCoreOptions()
			const command = createCreateSecretCommand(options)

			const result = await command({ name: '  GitHub token  ', valueRef: ' protected-ref ' }, context)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'secret-1',
					name: 'GitHub token',
					valueRef: 'protected-ref',
					created: localStamp(),
					replaced: null,
					archivePeriods: [],
				},
			})
		})
	})
}
