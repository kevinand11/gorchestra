import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedSecretPipe } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listSecretReferencesBySecretId } from './list-secret-references'
import { listSecret } from './list-secrets'
import { getRequired, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedSecretPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetSecretQuery(options: CoreServices): Operation {
	return buildQueryHandler('getSecret', inputPipe, (input) =>
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
	const { createTestCoreServices, seedAgentRunProfile, seedSecret } = await import('../utils/test-helpers')

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
			seedSecret(options.tx, '01k00000000000000000000040')
			const query = createGetSecretQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000040',
					name: 'Secret',
					created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
					updated: null,
					valueReplaced: null,
					archived: false,
					references: [],
				},
			})
		})

		it('includes Secret References for the target Secret', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', {
				runtimeRequirements: [{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' }],
			})
			const query = createGetSecretQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000040',
					name: 'Secret',
					created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
					updated: null,
					valueReplaced: null,
					archived: false,
					references: [
						{
							type: 'agent-run-profile-environment-secret',
							active: true,
							agentRunProfileId: '01k00000000000000000000006',
							name: 'Agent Run Profile',
							envName: 'NPM_TOKEN',
						},
					],
				},
			})
		})

		it('returns not-found when the target Secret does not exist', async () => {
			const query = createGetSecretQuery(createTestCoreServices())

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000040' } })
		})
	})
}
