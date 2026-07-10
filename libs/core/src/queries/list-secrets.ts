import { type PipeInput, type PipeOutput } from 'valleyed'

import { paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { listedSecretPipe, type ListedSecret, type Secret, type SecretReference } from '../domain/secret'
export type { ListedSecret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listSecretReferencesBySecretId } from './list-secret-references'
import { isArchived } from '../utils/command-storage'
import { buildQueryHandler } from '../utils/query-handler'
import { listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = paginatedQueryInputPipe
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(listedSecretPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListSecretsQuery(options: CoreServices): Operation {
	return buildQueryHandler('listSecrets', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const secrets = await listRecordsPaginated('secret', storage, input)
			if (!secrets.ok) return secrets

			const references = await listSecretReferencesBySecretId(
				storage,
				secrets.value.items.map((secret) => secret.id),
			)
			return references.ok
				? {
						ok: true,
						value: {
							...secrets.value,
							items: secrets.value.items.map((secret) => listSecret(secret, references.value.get(secret.id) ?? [])),
						},
					}
				: references
		}),
	) as Operation
}

export function listSecret(secret: Secret, references: SecretReference[]): ListedSecret {
	const { valueRef: _valueRef, archivePeriods, ...secretFields } = secret
	return { ...secretFields, archived: isArchived(archivePeriods), references }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, stamp } = await import('../utils/test-helpers')

	describe('listSecrets query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.fail.list = true
			const query = createListSecretsQuery(options)

			const result = await query(null as unknown as Input)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listSecrets' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns an empty Secret list for an empty Portfolio', async () => {
			const query = createListSecretsQuery(createTestCoreServices())

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 0, total: 0, count: 0 },
				},
			})
		})

		it('lists redacted Secret metadata in id-desc order with archive state', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.records.set(
				'01k00000000000000000100002',
				secret({ id: '01k00000000000000000100002', name: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
			)
			options.tx.secrets.records.set(
				'01k00000000000000000100003',
				secret({ id: '01k00000000000000000100003', name: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.secrets.records.set(
				'01k00000000000000000100001',
				secret({ id: '01k00000000000000000100001', name: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z', archived: true }),
			)
			const query = createListSecretsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						redactedSecret({ id: '01k00000000000000000100003', name: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
						redactedSecret({ id: '01k00000000000000000100002', name: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
						redactedSecret({
							id: '01k00000000000000000100001',
							name: 'Tie A',
							createdAt: '2026-06-09T00:00:00.000Z',
							archived: true,
						}),
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 3, total: 3, count: 3 },
				},
			})
		})

		it('includes Secret References for each listed Secret', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.records.set('01k00000000000000000000040', secret({ id: '01k00000000000000000000040', name: 'GitHub PAT' }))
			options.tx.repositories.records.set('01k00000000000000000000034', {
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
				created: { origin: 'imported', at: '2026-06-12T00:00:00.000Z' },
			})
			const query = createListSecretsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						{
							...redactedSecret({ id: '01k00000000000000000000040', name: 'GitHub PAT' }),
							references: [
								{
									type: 'repository-access',
									active: true,
									repositoryId: '01k00000000000000000000034',
									projectId: '01k00000000000000000000030',
									provider: 'github',
									owner: 'Octo',
									name: 'Repo',
								},
							],
						},
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 1, total: 1, count: 1 },
				},
			})
		})

		it('returns storage errors when Secret reads fail', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.fail.list = true
			const query = createListSecretsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'secret' } },
			})
		})
	})

	function secret(input: { id: string; name: string; createdAt?: string; archived?: boolean }): Secret {
		return {
			id: input.id,
			name: input.name,
			valueRef: 'protected-value-ref',
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
			updated: null,
			valueReplaced: null,
			archivePeriods: input.archived ? [{ archived: { origin: 'imported', at: '2026-06-11T00:00:00.000Z' }, unarchived: null }] : [],
		}
	}

	function redactedSecret(input: { id: string; name: string; createdAt?: string; archived?: boolean }): ListedSecret {
		return {
			id: input.id,
			name: input.name,
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
			updated: null,
			valueReplaced: null,
			archived: input.archived ?? false,
			references: [],
		}
	}
}
