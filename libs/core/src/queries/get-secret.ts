import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listSecretReferencesBySecretId } from './list-secret-references'
import { listSecret, type ListedSecret } from './list-secrets'
import { getRequired, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const getSecretInputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof getSecretInputPipe>

export type Result = ListedSecret
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSecretQuery(options: CoreServices): Operation {
	return buildQueryHandler('getSecret', getSecretInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const secret = await getRequired('secret', storage, input.secretId)
			if (!secret.ok) return secret

			const references = await listSecretReferencesBySecretId(storage, [input.secretId])
			return references.ok ? { ok: true, value: listSecret(secret.value, references.value.get(input.secretId) ?? []) } : references
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
					references: [],
				},
			})
		})

		it('includes Secret References for the target Secret', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			options.tx.secretBindings.records.set('binding-1', {
				id: 'binding-1',
				secretId: 'secret-1',
				scope: { type: 'portfolio' },
				envName: 'GITHUB_TOKEN',
				created: { origin: 'imported', at: '2026-06-12T00:00:00.000Z' },
				archivePeriods: [],
			})
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
					references: [
						{
							type: 'secret-binding',
							secretBindingId: 'binding-1',
							scope: { type: 'portfolio' },
							envName: 'GITHUB_TOKEN',
							archived: false,
							created: { origin: 'imported', at: '2026-06-12T00:00:00.000Z' },
						},
					],
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
