import { OrmValidationError } from 'equipped/orm'
import { PipeError } from 'valleyed'

import type { Id } from '../domain/commons'
import type { Secret } from '../domain/secret'
import { secretSchema } from '../domain/secret'
import type {
	InvalidCoreServiceOutputError,
	ResourceNotFoundError,
	ResourceArchivedError,
	SecretResolutionFailedError,
	StorageOperationFailedError,
} from '../errors'
import {
	resolvedSecretValuesPipe,
	type CoreServices,
	type CoreStorage,
	type ResolvableSecretValue,
	type ResolvedSecretValues,
} from '../services'
import { validateCoreServiceOutput } from '../validation'
import type { Result } from './types'

type ActiveSecretValueRefs = Record<Id, Result<ResolvableSecretValue, ResourceNotFoundError | ResourceArchivedError>>
type ResolvedSecretValueResults = Record<Id, Result<string, SecretResolutionFailedError>>
type ActiveSecretValueResults = Record<Id, Result<string, ResourceNotFoundError | ResourceArchivedError | SecretResolutionFailedError>>

export type ValidateActiveSecretResult = Result<
	Secret,
	ResourceNotFoundError | ResourceArchivedError | StorageOperationFailedError | InvalidCoreServiceOutputError
>

export type ValidateActiveSecretReferencesResult = Result<
	void,
	ResourceNotFoundError | ResourceArchivedError | StorageOperationFailedError | InvalidCoreServiceOutputError
>

export type ReadActiveSecretValueRefsResult = Result<ActiveSecretValueRefs, StorageOperationFailedError | InvalidCoreServiceOutputError>

export type ResolveSecretValueRefsResult = Result<ResolvedSecretValueResults, InvalidCoreServiceOutputError>

export type ResolveActiveSecretValuesResult = Result<ActiveSecretValueResults, StorageOperationFailedError | InvalidCoreServiceOutputError>

export async function validateActiveSecret(storage: CoreStorage, secretId: Id): Promise<ValidateActiveSecretResult> {
	const secrets = await listSecretRecords(storage, [secretId])
	if (!secrets.ok) return secrets

	const secret = secrets.value.at(0)
	if (secret === undefined) return { ok: false, error: { type: 'not-found', resource: 'secret', id: secretId } }
	return isArchived(secret.archivePeriods)
		? { ok: false, error: { type: 'resource-archived', resource: 'secret', id: secretId } }
		: { ok: true, value: secret }
}

export async function validateActiveSecretReferences(storage: CoreStorage, secretIds: Id[]): Promise<ValidateActiveSecretReferencesResult> {
	const uniqueSecretIds = uniqueIds(secretIds)
	if (uniqueSecretIds.length === 0) return validateActiveSecretReferencesFromRecords(uniqueSecretIds, [])

	const secrets = await listSecretRecords(storage, uniqueSecretIds)
	return secrets.ok ? validateActiveSecretReferencesFromRecords(uniqueSecretIds, secrets.value) : secrets
}

export function validateActiveSecretReferencesFromRecords(
	secretIds: Id[],
	secrets: Secret[],
): Result<void, ResourceNotFoundError | ResourceArchivedError> {
	const secretsById = new Map(secrets.map((secret) => [secret.id, secret]))
	for (const secretId of uniqueIds(secretIds)) {
		const secret = secretsById.get(secretId)
		if (secret === undefined) return { ok: false, error: { type: 'not-found', resource: 'secret', id: secretId } }
		if (isArchived(secret.archivePeriods)) {
			return { ok: false, error: { type: 'resource-archived', resource: 'secret', id: secretId } }
		}
	}

	return { ok: true, value: undefined }
}

export async function readActiveSecretValueRefs(storage: CoreStorage, secretIds: Id[]): Promise<ReadActiveSecretValueRefsResult> {
	const uniqueSecretIds = uniqueIds(secretIds)
	if (uniqueSecretIds.length === 0) return { ok: true, value: {} }

	const secrets = await listSecretRecords(storage, uniqueSecretIds)
	if (!secrets.ok) return secrets

	const secretsById = new Map(secrets.value.map((secret) => [secret.id, secret]))
	const value: ActiveSecretValueRefs = {}
	for (const secretId of uniqueSecretIds) {
		const secret = secretsById.get(secretId)
		if (secret === undefined) value[secretId] = { ok: false, error: { type: 'not-found', resource: 'secret', id: secretId } }
		else if (isArchived(secret.archivePeriods))
			value[secretId] = { ok: false, error: { type: 'resource-archived', resource: 'secret', id: secretId } }
		else value[secretId] = { ok: true, value: { secretId: secret.id, valueRef: secret.valueRef } }
	}
	return { ok: true, value }
}

export async function resolveSecretValueRefs(
	services: Pick<CoreServices, 'secrets'>,
	secrets: ResolvableSecretValue[],
): Promise<ResolveSecretValueRefsResult> {
	const uniqueSecrets = [...new Map(secrets.map((secret) => [secret.secretId, secret])).values()]
	if (uniqueSecrets.length === 0) return { ok: true, value: {} }

	let output: unknown
	try {
		output = await services.secrets.resolveSecretValues({ secrets: uniqueSecrets })
	} catch {
		return { ok: true, value: secretResolutionFailures(uniqueSecrets) }
	}

	const validated = validateCoreServiceOutput(resolvedSecretValuesPipe, output, 'secrets', 'resolveSecretValues')
	return validated.ok ? { ok: true, value: resolvedSecretValueResults(uniqueSecrets, validated.value) } : validated
}

export async function resolveActiveSecretValues(
	services: Pick<CoreServices, 'secrets'>,
	storage: CoreStorage,
	secretIds: Id[],
): Promise<ResolveActiveSecretValuesResult> {
	const refs = await readActiveSecretValueRefs(storage, secretIds)
	if (!refs.ok) return refs

	const activeRefs = Object.values(refs.value).flatMap((result) => (result.ok ? [result.value] : []))
	const resolved = await resolveSecretValueRefs(services, activeRefs)
	if (!resolved.ok) return resolved

	const value: ActiveSecretValueResults = {}
	for (const [secretId, ref] of Object.entries(refs.value)) {
		value[secretId] = ref.ok ? (resolved.value[secretId] ?? secretResolutionFailure(secretId)) : ref
	}
	return { ok: true, value }
}

async function listSecretRecords(
	storage: CoreStorage,
	secretIds: Id[],
): Promise<Result<Secret[], StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	try {
		const records = await storage
			.on(secretSchema)
			.all()
			.where((filter) => filter.in(secretSchema.fields.id, secretIds))
			.find()
		return { ok: true, value: records }
	} catch (error) {
		return error instanceof OrmValidationError
			? {
					ok: false,
					error: {
						type: 'invalid-core-service-output',
						service: 'storage',
						operation: 'list:secret',
						pipeError: PipeError.root('Stored Core record failed schema validation.', null),
					},
				}
			: { ok: false, error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'secret' } } }
	}
}

function isArchived(archivePeriods: Secret['archivePeriods']): boolean {
	const latestPeriod = archivePeriods.at(-1)
	return latestPeriod !== undefined && latestPeriod.unarchived === null
}

function uniqueIds(ids: Id[]): Id[] {
	return [...new Set(ids)]
}

function resolvedSecretValueResults(secrets: ResolvableSecretValue[], values: ResolvedSecretValues): ResolvedSecretValueResults {
	const results: ResolvedSecretValueResults = {}
	for (const secret of secrets) {
		const value = values[secret.secretId]
		results[secret.secretId] = value === undefined ? secretResolutionFailure(secret.secretId) : { ok: true, value }
	}
	return results
}

function secretResolutionFailures(secrets: ResolvableSecretValue[]): ResolvedSecretValueResults {
	const results: ResolvedSecretValueResults = {}
	for (const secret of secrets) {
		results[secret.secretId] = secretResolutionFailure(secret.secretId)
	}
	return results
}

function secretResolutionFailure(secretId: Id): Result<never, SecretResolutionFailedError> {
	return { ok: false, error: { type: 'secret-resolution-failed', secretId } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Secret utilities', () => {
		it('validates one active Secret and reports inactive Secrets', async () => {
			const storage = storageWithSecrets([
				secretRecord('01k00000000000000000000040'),
				secretRecord('01k00000000000000000000041', true),
			])

			await expect(validateActiveSecret(storage, '01k00000000000000000000040')).resolves.toMatchObject({ ok: true })
			await expect(validateActiveSecret(storage, '01k00000000000000000000041')).resolves.toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'secret', id: '01k00000000000000000000041' },
			})
		})

		it('validates active Secret references with a batched lookup and returns the first caller-ordered failure', async () => {
			const result = await validateActiveSecretReferences(
				storageWithSecrets([secretRecord('01k00000000000000000000040'), secretRecord('01k00000000000000000000041', true)]),
				['01k00000000000000000000042', '01k00000000000000000000041', '01k00000000000000000000042'],
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000042' },
			})
		})

		it('reads active Secret value refs in one batched storage call and reports missing or inactive Secrets per id', async () => {
			const result = await readActiveSecretValueRefs(
				storageWithSecrets([secretRecord('01k00000000000000000000040'), secretRecord('01k00000000000000000000041', true)]),
				['01k00000000000000000000040', '01k00000000000000000000041', '01k00000000000000000000042', '01k00000000000000000000040'],
			)

			expect(result).toEqual({
				ok: true,
				value: {
					'01k00000000000000000000040': {
						ok: true,
						value: { secretId: '01k00000000000000000000040', valueRef: 'protected-ref' },
					},
					'01k00000000000000000000041': {
						ok: false,
						error: { type: 'resource-archived', resource: 'secret', id: '01k00000000000000000000041' },
					},
					'01k00000000000000000000042': {
						ok: false,
						error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000042' },
					},
				},
			})
		})

		it('resolves Secret value refs and reports omitted values per Secret', async () => {
			const result = await resolveSecretValueRefs(
				{
					secrets: {
						preflight: () => Promise.resolve({ ok: true }),
						resolveSecrets: () => Promise.resolve([]),
						resolveSecretValues: () => Promise.resolve({ '01k00000000000000000000040': 'token' }),
					},
				},
				[
					{ secretId: '01k00000000000000000000040', valueRef: 'ref-40' },
					{ secretId: '01k00000000000000000000041', valueRef: 'ref-41' },
				],
			)

			expect(result).toEqual({
				ok: true,
				value: {
					'01k00000000000000000000040': { ok: true, value: 'token' },
					'01k00000000000000000000041': {
						ok: false,
						error: { type: 'secret-resolution-failed', secretId: '01k00000000000000000000041' },
					},
				},
			})
		})

		it('composes active Secret reads and value resolution without resolving missing or inactive Secrets', async () => {
			const requestedSecretIds: Id[][] = []
			const storage = storageWithSecrets([
				secretRecord('01k00000000000000000000040'),
				secretRecord('01k00000000000000000000041', true),
			])

			const result = await resolveActiveSecretValues(
				{
					secrets: {
						preflight: () => Promise.resolve({ ok: true }),
						resolveSecrets: () => Promise.resolve([]),
						resolveSecretValues: (input) => {
							requestedSecretIds.push(input.secrets.map((secret) => secret.secretId))
							return Promise.resolve({ '01k00000000000000000000040': 'plaintext' })
						},
					},
				},
				storage,
				['01k00000000000000000000040', '01k00000000000000000000041', '01k00000000000000000000042'],
			)

			expect(requestedSecretIds).toEqual([['01k00000000000000000000040']])
			expect(result).toEqual({
				ok: true,
				value: {
					'01k00000000000000000000040': { ok: true, value: 'plaintext' },
					'01k00000000000000000000041': {
						ok: false,
						error: { type: 'resource-archived', resource: 'secret', id: '01k00000000000000000000041' },
					},
					'01k00000000000000000000042': {
						ok: false,
						error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000042' },
					},
				},
			})
		})
	})

	function storageWithSecrets(secrets: Secret[]): CoreStorage {
		const byId = new Map(secrets.map((secret) => [secret.id, secret]))
		return {
			on: () => ({
				one: () => ({ id: (id: Id) => ({ find: () => Promise.resolve(byId.get(id) ?? null) }) }),
				all: () => ({
					where: (configure: (filter: SecretFilter) => unknown) => {
						const filter = createSecretFilter()
						configure(filter)
						return { find: () => Promise.resolve(filterSecrets(byId, filter)) }
					},
				}),
			}),
			session: (run: () => unknown) => Promise.resolve(run()),
		} as unknown as CoreStorage
	}

	interface SecretFilter {
		ids: Id[] | null
		in: (_field: unknown, ids: Id[]) => SecretFilter
	}

	function createSecretFilter(): SecretFilter {
		const filter: SecretFilter = {
			ids: null,
			in: (_field, ids) => {
				filter.ids = ids
				return filter
			},
		}
		return filter
	}

	function filterSecrets(secrets: Map<Id, Secret>, filter: SecretFilter): Secret[] {
		return filter.ids === null ? [...secrets.values()] : filter.ids.flatMap((id) => secrets.get(id) ?? [])
	}

	function secretRecord(id: Id, archived = false): Secret {
		return {
			id,
			name: 'Secret',
			valueRef: 'protected-ref',
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			valueReplaced: null,
			archivePeriods: archived ? [{ archived: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' }, unarchived: null }] : [],
		}
	}
}
