import { v, type PipeOutput } from 'valleyed'

import { isArchived } from '../commands/utils/storage'
import { idPipe, type Id } from '../domain/commons'
import type { ModelProvider } from '../domain/model-provider'
import type { Repository } from '../domain/repository'
import { secretReferencePipe, type SecretBinding, type SecretReference } from '../domain/secret'
export type {
	ModelProviderAuthSecretReference,
	ModelProviderHeaderSecretReference,
	RepositoryAccessSecretReference,
	SecretBindingSecretReference,
	SecretReference,
} from '../domain/secret'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import { getRequired, listRecords, withTransaction, type StorageBoundaryError } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

export const inputPipe = v.object({ secretId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = v.array(secretReferencePipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListSecretReferencesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listSecretReferences', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const secret = await getRequired('secret', storage, input.secretId)
			if (!secret.ok) return secret

			const references = await listSecretReferencesBySecretId(storage, [input.secretId])
			return references.ok ? { ok: true, value: references.value.get(input.secretId) ?? [] } : references
		}),
	)
}

export async function listSecretReferencesBySecretId(
	storage: CoreStorage,
	secretIds: readonly Id[],
): Promise<CoreResult<Map<Id, SecretReference[]>, StorageBoundaryError>> {
	if (secretIds.length === 0) return { ok: true, value: emptySecretReferencesBySecretId(secretIds) }

	const matches = await collectSecretReferenceMatches(storage, secretIds, new Set(secretIds))
	return matches.ok ? { ok: true, value: secretReferencesBySecretId(secretIds, matches.value) } : matches
}

type SecretReferenceMatch = { secretId: Id; reference: SecretReference }

async function collectSecretReferenceMatches(
	storage: CoreStorage,
	secretIds: readonly Id[],
	secretIdSet: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const repositoryReferences = await listRepositorySecretReferences(storage, secretIdSet)
	if (!repositoryReferences.ok) return repositoryReferences

	const secretBindingReferences = await listSecretBindingSecretReferences(storage, secretIds, secretIdSet)
	if (!secretBindingReferences.ok) return secretBindingReferences

	const modelProviderReferences = await listModelProviderSecretReferences(storage, secretIdSet)
	return modelProviderReferences.ok
		? { ok: true, value: [...repositoryReferences.value, ...secretBindingReferences.value, ...modelProviderReferences.value] }
		: modelProviderReferences
}

function secretReferencesBySecretId(secretIds: readonly Id[], matches: SecretReferenceMatch[]): Map<Id, SecretReference[]> {
	const referencesBySecretId = emptySecretReferencesBySecretId(secretIds)
	for (const { secretId, reference } of matches) referencesBySecretId.get(secretId)?.push(reference)
	for (const [secretId, references] of referencesBySecretId) referencesBySecretId.set(secretId, sortSecretReferences(references))
	return referencesBySecretId
}

function emptySecretReferencesBySecretId(secretIds: readonly Id[]): Map<Id, SecretReference[]> {
	return new Map(secretIds.map((secretId) => [secretId, []]))
}

async function listRepositorySecretReferences(
	storage: CoreStorage,
	secretIds: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const repositories = await listRecords('repository', storage)
	if (!repositories.ok) return repositories

	return { ok: true, value: repositories.value.flatMap((repository) => repositorySecretReference(repository, secretIds)) }
}

function repositorySecretReference(repository: Repository, secretIds: Set<Id>): SecretReferenceMatch[] {
	switch (repository.config.provider) {
		case 'github':
			return secretIds.has(repository.config.secretId)
				? [
						{
							secretId: repository.config.secretId,
							reference: {
								type: 'repository-access',
								repositoryId: repository.id,
								projectId: repository.projectId,
								provider: 'github',
								owner: repository.config.owner,
								name: repository.config.name,
								created: repository.created,
							},
						},
					]
				: []
	}
}

async function listSecretBindingSecretReferences(
	storage: CoreStorage,
	secretIds: readonly Id[],
	secretIdSet: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const bindings = await listSecretBindingsForSecretIds(storage, secretIds)
	if (!bindings.ok) return bindings

	return { ok: true, value: bindings.value.flatMap((binding) => secretBindingSecretReference(binding, secretIdSet)) }
}

function listSecretBindingsForSecretIds(
	storage: CoreStorage,
	secretIds: readonly Id[],
): Promise<CoreResult<SecretBinding[], StorageBoundaryError>> {
	return secretIds.length === 1
		? listRecords('secret-binding', storage, { where: (filter, fields) => filter.eq(fields.secretId, secretIds[0]!) })
		: listRecords('secret-binding', storage)
}

function secretBindingSecretReference(binding: SecretBinding, secretIds: Set<Id>): SecretReferenceMatch[] {
	return secretIds.has(binding.secretId)
		? [
				{
					secretId: binding.secretId,
					reference: {
						type: 'secret-binding',
						secretBindingId: binding.id,
						scope: binding.scope,
						envName: binding.envName,
						archived: isArchived(binding.archivePeriods),
						created: binding.created,
					},
				},
			]
		: []
}

async function listModelProviderSecretReferences(
	storage: CoreStorage,
	secretIds: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const modelProviders = await listRecords('model-provider', storage)
	if (!modelProviders.ok) return modelProviders

	return { ok: true, value: modelProviders.value.flatMap((modelProvider) => modelProviderSecretReferences(modelProvider, secretIds)) }
}

function modelProviderSecretReferences(modelProvider: ModelProvider, secretIds: Set<Id>): SecretReferenceMatch[] {
	const archived = isArchived(modelProvider.archivePeriods)
	return [
		...modelProviderAuthSecretReference(modelProvider, secretIds, archived),
		...modelProvider.headers.flatMap((header) => modelProviderHeaderSecretReference(modelProvider, header, secretIds, archived)),
	]
}

function modelProviderAuthSecretReference(modelProvider: ModelProvider, secretIds: Set<Id>, archived: boolean): SecretReferenceMatch[] {
	const auth = modelProvider.auth
	return auth !== null && secretIds.has(auth.secretId)
		? [
				{
					secretId: auth.secretId,
					reference: {
						type: 'model-provider-auth',
						modelProviderId: modelProvider.id,
						name: modelProvider.name,
						protocol: modelProvider.protocol,
						archived,
						created: modelProvider.created,
					},
				},
			]
		: []
}

function modelProviderHeaderSecretReference(
	modelProvider: ModelProvider,
	header: ModelProvider['headers'][number],
	secretIds: Set<Id>,
	archived: boolean,
): SecretReferenceMatch[] {
	return secretIds.has(header.valueSecretId)
		? [
				{
					secretId: header.valueSecretId,
					reference: {
						type: 'model-provider-header',
						modelProviderId: modelProvider.id,
						name: modelProvider.name,
						protocol: modelProvider.protocol,
						headerName: header.name,
						archived,
						created: modelProvider.created,
					},
				},
			]
		: []
}

function sortSecretReferences(references: SecretReference[]): SecretReference[] {
	return [...references].sort(compareSecretReferences)
}

function compareSecretReferences(left: SecretReference, right: SecretReference): number {
	return firstNonZero([
		referenceTypeOrder[left.type] - referenceTypeOrder[right.type],
		referenceArchiveRank(left) - referenceArchiveRank(right),
		referenceLabel(left).localeCompare(referenceLabel(right)),
		left.created.at.localeCompare(right.created.at),
		referenceId(left).localeCompare(referenceId(right)),
	])
}

function firstNonZero(values: number[]): number {
	return values.find((value) => value !== 0) ?? 0
}

const referenceTypeOrder: Record<SecretReference['type'], number> = {
	'repository-access': 0,
	'model-provider-auth': 1,
	'model-provider-header': 2,
	'secret-binding': 3,
}

function referenceArchiveRank(reference: SecretReference): number {
	return 'archived' in reference && reference.archived ? 1 : 0
}

type SecretReferenceReader<T> = {
	[ReferenceType in SecretReference['type']]: (reference: Extract<SecretReference, { type: ReferenceType }>) => T
}

const referenceLabelByType: SecretReferenceReader<string> = {
	'repository-access': (reference) => `${reference.owner}/${reference.name}`,
	'model-provider-auth': (reference) => reference.name,
	'model-provider-header': (reference) => `${reference.name}/${reference.headerName}`,
	'secret-binding': (reference) => reference.envName,
}

const referenceIdByType: SecretReferenceReader<string> = {
	'repository-access': (reference) => reference.repositoryId,
	'model-provider-auth': (reference) => reference.modelProviderId,
	'model-provider-header': (reference) => reference.modelProviderId,
	'secret-binding': (reference) => reference.secretBindingId,
}

function referenceLabel(reference: SecretReference): string {
	return referenceLabelByType[reference.type](reference as never)
}

function referenceId(reference: SecretReference): string {
	return referenceIdByType[reference.type](reference as never)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('listSecretReferences query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.secrets.fail.get = true
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listSecretReferences' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Secret does not exist', async () => {
			const query = createListSecretReferencesQuery(createTestCoreServices())

			const result = await query({ secretId: 'secret-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: 'secret-1' } })
		})

		it('returns display-ready references for all Core Secret usages', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			seedSecretReferenceFixtures(options)
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: 'secret-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'repository-access',
						repositoryId: 'repository-1',
						projectId: 'project-1',
						provider: 'github',
						owner: 'Octo',
						name: 'Repo',
						created: stamp,
					},
					{
						type: 'model-provider-auth',
						modelProviderId: 'model-provider-1',
						name: 'Anthropic',
						protocol: { type: 'anthropic-messages' },
						archived: true,
						created: stamp,
					},
					{
						type: 'model-provider-header',
						modelProviderId: 'model-provider-1',
						name: 'Anthropic',
						protocol: { type: 'anthropic-messages' },
						headerName: 'X-Team',
						archived: true,
						created: stamp,
					},
					{
						type: 'secret-binding',
						secretBindingId: 'binding-1',
						scope: { type: 'project', projectId: 'missing-project' },
						envName: 'GITHUB_TOKEN',
						archived: true,
						created: stamp,
					},
				],
			})
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, 'secret-1')
			options.tx.repositories.fail.list = true
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: 'secret-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'repository' } },
			})
		})
	})

	function seedSecretReferenceFixtures(options: ReturnType<typeof createTestCoreServices>): void {
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: stamp,
		})
		options.tx.repositories.records.set('repository-2', {
			id: 'repository-2',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Other', secretId: 'secret-2' },
			created: stamp,
		})
		options.tx.secretBindings.records.set('binding-1', {
			id: 'binding-1',
			secretId: 'secret-1',
			scope: { type: 'project', projectId: 'missing-project' },
			envName: 'GITHUB_TOKEN',
			created: stamp,
			archivePeriods: [{ archived: stamp, unarchived: null }],
		})
		options.tx.modelProviders.records.set('model-provider-1', {
			id: 'model-provider-1',
			name: 'Anthropic',
			protocol: { type: 'anthropic-messages' },
			baseUrl: 'https://api.anthropic.com',
			auth: { type: 'apiKey', secretId: 'secret-1' },
			headers: [
				{ name: 'X-Team', valueSecretId: 'secret-1' },
				{ name: 'X-Other', valueSecretId: 'secret-2' },
			],
			created: stamp,
			updated: null,
			archivePeriods: [{ archived: stamp, unarchived: null }],
		})
	}
}
