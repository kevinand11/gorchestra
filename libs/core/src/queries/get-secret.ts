import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listSecret, type ListedSecret } from './list-secrets'
import { buildQueryHandler } from './utils'
import { getRequired, withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const getSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof getSecretInputPipe>

export type Result = ListedSecret
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSecretQuery(options: CoreServices): Operation {
	return buildQueryHandler('getSecret', getSecretInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const secret = await getRequired('secret', storage, input.secretId)
			return secret.ok ? { ok: true, value: listSecret(secret.value) } : secret
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedSecret } = await import('../utils/test-helpers')

	describe('getSecret query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.fail.get = true
			const query = createGetSecretQuery(options)

			const result = await query({ secretId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getSecret' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns redacted Secret metadata by id', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			const query = createGetSecretQuery(options)

			const result = await query({ secretId: 'secret-1' })

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'secret-1',
					name: 'Secret',
					created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
					replaced: null,
					archived: false,
				},
			})
		})

		it('returns not-found when the target Secret does not exist', async () => {
			const query = createGetSecretQuery(createTestCoreServices())

			const result = await query({ secretId: 'secret-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: 'secret-1' } })
		})
	})
}
