import { v, type PipeOutput } from 'valleyed'

import { isArchived } from '../commands/utils/storage'
import { listedSecretPipe, type ListedSecret, type Secret, type SecretReference } from '../domain/secret'
export type { ListedSecret } from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listSecretReferencesBySecretId } from './list-secret-references'
import { listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({})
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(listedSecretPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListSecretsQuery(options: CoreServices): Operation {
	return buildQueryHandler('listSecrets', inputPipe, () =>
		withTransaction(options, async (storage) => {
			const secrets = await listRecords('secret', storage)
			if (!secrets.ok) return secrets

			const sortedSecrets = sortByCreatedAtThenId(secrets.value)
			const references = await listSecretReferencesBySecretId(
				storage,
				sortedSecrets.map((secret) => secret.id),
			)
			return references.ok ? { ok: true, value: listSecrets(sortedSecrets, references.value) } : references
		}),
	)
}

function listSecrets(secrets: Secret[], referencesBySecretId: Map<string, SecretReference[]>): ListedSecret[] {
	return secrets.map((secret) => listSecret(secret, referencesBySecretId.get(secret.id) ?? []))
}

export function listSecret(secret: Secret, references: SecretReference[]): ListedSecret {
	const { valueRef: _valueRef, archivePeriods, ...secretFields } = secret
	return { ...secretFields, archived: isArchived(archivePeriods), references }
}

function sortByCreatedAtThenId<T extends { id: string; created: { at: string } }>(records: T[]): T[] {
	return [...records].sort((left, right) => left.created.at.localeCompare(right.created.at) || left.id.localeCompare(right.id))
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

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('lists redacted Secret metadata in creation order with archive state', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.records.set('secret-b', secret({ id: 'secret-b', name: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }))
			options.tx.secrets.records.set('secret-c', secret({ id: 'secret-c', name: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }))
			options.tx.secrets.records.set(
				'secret-a',
				secret({ id: 'secret-a', name: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z', archived: true }),
			)
			const query = createListSecretsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: [
					redactedSecret({ id: 'secret-a', name: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z', archived: true }),
					redactedSecret({ id: 'secret-c', name: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
					redactedSecret({ id: 'secret-b', name: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
				],
			})
		})

		it('includes Secret References for each listed Secret', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.records.set('secret-1', secret({ id: 'secret-1', name: 'GitHub PAT' }))
			options.tx.repositories.records.set('repository-1', {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: { origin: 'imported', at: '2026-06-12T00:00:00.000Z' },
			})
			const query = createListSecretsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: [
					{
						...redactedSecret({ id: 'secret-1', name: 'GitHub PAT' }),
						references: [
							{
								type: 'repository-access',
								repositoryId: 'repository-1',
								projectId: 'project-1',
								provider: 'github',
								owner: 'Octo',
								name: 'Repo',
								created: { origin: 'imported', at: '2026-06-12T00:00:00.000Z' },
							},
						],
					},
				],
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
			replaced: null,
			archivePeriods: input.archived ? [{ archived: { origin: 'imported', at: '2026-06-11T00:00:00.000Z' }, unarchived: null }] : [],
		}
	}

	function redactedSecret(input: { id: string; name: string; createdAt?: string; archived?: boolean }): ListedSecret {
		return {
			id: input.id,
			name: input.name,
			created: { origin: 'imported', at: input.createdAt ?? stamp.at },
			replaced: null,
			archived: input.archived ?? false,
			references: [],
		}
	}
}
