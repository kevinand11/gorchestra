import { v, type PipeOutput } from 'valleyed'

import { isArchived } from '../commands/utils/storage'
import type { AgentRunProfile } from '../domain/agent-run-profile'
import type { AgentRunRuntimeRequirement, VercelSandboxCredentialsSecretRefs } from '../domain/agent-run-runtime'
import { idPipe, type Id } from '../domain/commons'
import { modelProviderProtocolForSource, type ModelProvider, type ModelProviderAccessValue } from '../domain/model-provider'
import type { Repository } from '../domain/repository'
import { secretReferencePipe, type AgentRunProfileSandboxCredentialSecretReference, type SecretReference } from '../domain/secret'
export type {
	AgentRunProfileEnvironmentSecretReference,
	AgentRunProfileRunCommandSecretReference,
	AgentRunProfileSandboxCredentialSecretReference,
	ModelProviderAuthSecretReference,
	ModelProviderHeaderSecretReference,
	RepositoryAccessSecretReference,
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

	const matches = await collectSecretReferenceMatches(storage, new Set(secretIds))
	return matches.ok ? { ok: true, value: secretReferencesBySecretId(secretIds, matches.value) } : matches
}

type SecretReferenceMatch = { secretId: Id; reference: SecretReference }

async function collectSecretReferenceMatches(
	storage: CoreStorage,
	secretIdSet: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const repositoryReferences = await listRepositorySecretReferences(storage, secretIdSet)
	if (!repositoryReferences.ok) return repositoryReferences

	const agentRunProfileReferences = await listAgentRunProfileSecretReferences(storage, secretIdSet)
	if (!agentRunProfileReferences.ok) return agentRunProfileReferences

	const modelProviderReferences = await listModelProviderSecretReferences(storage, secretIdSet)
	return modelProviderReferences.ok
		? { ok: true, value: [...repositoryReferences.value, ...agentRunProfileReferences.value, ...modelProviderReferences.value] }
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
								active: true,
								repositoryId: repository.id,
								projectId: repository.projectId,
								provider: 'github',
								owner: repository.config.owner,
								name: repository.config.name,
							},
						},
					]
				: []
	}
}

async function listAgentRunProfileSecretReferences(
	storage: CoreStorage,
	secretIds: Set<Id>,
): Promise<CoreResult<SecretReferenceMatch[], StorageBoundaryError>> {
	const profiles = await listRecords('agent-run-profile', storage)
	if (!profiles.ok) return profiles

	return { ok: true, value: profiles.value.flatMap((profile) => agentRunProfileSecretReferences(profile, secretIds)) }
}

function agentRunProfileSecretReferences(profile: AgentRunProfile, secretIds: Set<Id>): SecretReferenceMatch[] {
	const active = !isArchived(profile.archivePeriods)
	return [
		...profile.runtimeRequirements.flatMap((requirement) =>
			agentRunProfileRequirementSecretReferences(profile, requirement, secretIds, active),
		),
		...agentRunProfileSandboxCredentialSecretReferences(profile, secretIds, active),
	]
}

function agentRunProfileRequirementSecretReferences(
	profile: AgentRunProfile,
	requirement: AgentRunRuntimeRequirement,
	secretIds: Set<Id>,
	active: boolean,
): SecretReferenceMatch[] {
	switch (requirement.type) {
		case 'environment-secret':
			return secretIds.has(requirement.secretId)
				? [
						{
							secretId: requirement.secretId,
							reference: {
								type: 'agent-run-profile-environment-secret',
								active,
								agentRunProfileId: profile.id,
								name: profile.name,
								envName: requirement.envName,
							},
						},
					]
				: []
		case 'run-command':
			return Object.entries(requirement.commandSecretEnv).flatMap(([envName, secretId]) =>
				secretIds.has(secretId)
					? [
							{
								secretId,
								reference: {
									type: 'agent-run-profile-run-command-secret',
									active,
									agentRunProfileId: profile.id,
									name: profile.name,
									label: requirement.label,
									envName,
								},
							},
						]
					: [],
			)
		default:
			throw new Error(`Unexpected Agent Run Runtime Requirement type: ${String(requirement satisfies never)}`)
	}
}

function agentRunProfileSandboxCredentialSecretReferences(
	profile: AgentRunProfile,
	secretIds: Set<Id>,
	active: boolean,
): SecretReferenceMatch[] {
	switch (profile.sandboxConfig.source.type) {
		case 'consumer-managed':
			return []
		case 'vercel-runtime':
		case 'vercel-vcr-image':
			return vercelCredentialSecretReferences(profile, profile.sandboxConfig.source.credentials, secretIds, active)
		default:
			throw new Error(`Unexpected Agent Run Sandbox source type: ${String(profile.sandboxConfig.source satisfies never)}`)
	}
}

function vercelCredentialSecretReferences(
	profile: AgentRunProfile,
	credentials: VercelSandboxCredentialsSecretRefs,
	secretIds: Set<Id>,
	active: boolean,
): SecretReferenceMatch[] {
	return [
		vercelCredentialSecretReference(profile, credentials.tokenSecretId, 'vercel-token', secretIds, active),
		vercelCredentialSecretReference(profile, credentials.teamIdSecretId, 'vercel-team-id', secretIds, active),
		vercelCredentialSecretReference(profile, credentials.projectIdSecretId, 'vercel-project-id', secretIds, active),
	].flatMap((reference) => (reference === null ? [] : [reference]))
}

function vercelCredentialSecretReference(
	profile: AgentRunProfile,
	secretId: Id,
	credential: AgentRunProfileSandboxCredentialSecretReference['credential'],
	secretIds: Set<Id>,
	active: boolean,
): SecretReferenceMatch | null {
	return secretIds.has(secretId)
		? {
				secretId,
				reference: {
					type: 'agent-run-profile-sandbox-credential',
					active,
					agentRunProfileId: profile.id,
					name: profile.name,
					credential,
				},
			}
		: null
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
	const secretId = modelProvider.auth === null ? null : secretIdFromAccessValue(modelProvider.auth.value)
	return secretId !== null && secretIds.has(secretId)
		? [
				{
					secretId,
					reference: {
						type: 'model-provider-auth',
						active: !archived,
						modelProviderId: modelProvider.id,
						name: modelProvider.name,
						protocol: modelProviderProtocolForSource(modelProvider.source),
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
	const secretId = secretIdFromAccessValue(header.value)
	return secretIds.has(secretId)
		? [
				{
					secretId,
					reference: {
						type: 'model-provider-header',
						active: !archived,
						modelProviderId: modelProvider.id,
						name: modelProvider.name,
						protocol: modelProviderProtocolForSource(modelProvider.source),
						headerName: header.name,
					},
				},
			]
		: []
}

function secretIdFromAccessValue(value: ModelProviderAccessValue): Id {
	switch (value.type) {
		case 'secret':
			return value.secretId
		default:
			throw new Error('Unexpected Model Provider access value.')
	}
}

function sortSecretReferences(references: SecretReference[]): SecretReference[] {
	return [...references].sort(compareSecretReferences)
}

function compareSecretReferences(left: SecretReference, right: SecretReference): number {
	return firstNonZero([
		referenceTypeOrder[left.type] - referenceTypeOrder[right.type],
		referenceActiveRank(left) - referenceActiveRank(right),
		referenceLabel(left).localeCompare(referenceLabel(right)),
		referenceId(left).localeCompare(referenceId(right)),
	])
}

function firstNonZero(values: number[]): number {
	return values.find((value) => value !== 0) ?? 0
}

const referenceTypeOrder: Record<SecretReference['type'], number> = {
	'repository-access': 0,
	'agent-run-profile-environment-secret': 1,
	'agent-run-profile-run-command-secret': 2,
	'agent-run-profile-sandbox-credential': 3,
	'model-provider-auth': 4,
	'model-provider-header': 5,
}

function referenceActiveRank(reference: Pick<SecretReference, 'active'>): number {
	return reference.active ? 0 : 1
}

function referenceLabel(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return `${reference.owner}/${reference.name}`
		case 'agent-run-profile-environment-secret':
			return `${reference.name}/${reference.envName}`
		case 'agent-run-profile-run-command-secret':
			return `${reference.name}/${reference.label}/${reference.envName}`
		case 'agent-run-profile-sandbox-credential':
			return `${reference.name}/${reference.credential}`
		case 'model-provider-auth':
			return reference.name
		case 'model-provider-header':
			return `${reference.name}/${reference.headerName}`
		default:
			throw new Error(`Unexpected Secret Reference type: ${String(reference satisfies never)}`)
	}
}

function referenceId(reference: SecretReference): string {
	switch (reference.type) {
		case 'repository-access':
			return reference.repositoryId
		case 'agent-run-profile-environment-secret':
			return reference.agentRunProfileId
		case 'agent-run-profile-run-command-secret':
			return reference.agentRunProfileId
		case 'agent-run-profile-sandbox-credential':
			return reference.agentRunProfileId
		case 'model-provider-auth':
			return reference.modelProviderId
		case 'model-provider-header':
			return reference.modelProviderId
		default:
			throw new Error(`Unexpected Secret Reference type: ${String(reference satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedAgentRunProfile, seedSecret, stamp } = await import('../utils/test-helpers')

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

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: '01k00000000000000000000040' } })
		})

		it('returns display-ready references for all Core Secret usages', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			seedSecretReferenceFixtures(options)
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'repository-access',
						active: true,
						repositoryId: '01k00000000000000000000034',
						projectId: '01k00000000000000000000030',
						provider: 'github',
						owner: 'Octo',
						name: 'Repo',
					},
					{
						type: 'agent-run-profile-environment-secret',
						active: false,
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Agent Run Profile',
						envName: 'NPM_TOKEN',
					},
					{
						type: 'agent-run-profile-run-command-secret',
						active: false,
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Agent Run Profile',
						label: 'Install packages',
						envName: 'NPM_TOKEN',
					},
					{
						type: 'model-provider-auth',
						active: false,
						modelProviderId: '01k00000000000000000000027',
						name: 'Anthropic',
						protocol: 'anthropic-messages',
					},
					{
						type: 'model-provider-header',
						active: false,
						modelProviderId: '01k00000000000000000000027',
						name: 'Anthropic',
						protocol: 'anthropic-messages',
						headerName: 'X-Team',
					},
				],
			})
		})

		it('returns Agent Run Profile sandbox credential references for Vercel configs', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			seedSecret(options.tx, '01k00000000000000000000042')
			seedAgentRunProfile(options.tx, '01k00000000000000000000006')
			options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.sandboxConfig = {
				source: {
					type: 'vercel-runtime',
					runtime: 'node24',
					credentials: {
						tokenSecretId: '01k00000000000000000000040',
						teamIdSecretId: '01k00000000000000000000041',
						projectIdSecretId: '01k00000000000000000000042',
					},
				},
				resources: { vcpus: 2 },
				networkPolicy: { type: 'allow-all' },
			}
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'agent-run-profile-sandbox-credential',
						active: true,
						agentRunProfileId: '01k00000000000000000000006',
						name: 'Agent Run Profile',
						credential: 'vercel-token',
					},
				],
			})
		})

		it('orders active references before inactive references within a reference type', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			seedAgentRunProfile(options.tx, 'profile-active-z', '01k00000000000000000000024', {
				runtimeRequirements: [{ type: 'environment-secret', envName: 'Z_ACTIVE', secretId: '01k00000000000000000000040' }],
			})
			seedAgentRunProfile(options.tx, 'profile-inactive-a', '01k00000000000000000000024', {
				archived: true,
				runtimeRequirements: [{ type: 'environment-secret', envName: 'A_INACTIVE', secretId: '01k00000000000000000000040' }],
			})
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: true,
				value: [
					{
						type: 'agent-run-profile-environment-secret',
						active: true,
						agentRunProfileId: 'profile-active-z',
						name: 'Agent Run Profile',
						envName: 'Z_ACTIVE',
					},
					{
						type: 'agent-run-profile-environment-secret',
						active: false,
						agentRunProfileId: 'profile-inactive-a',
						name: 'Agent Run Profile',
						envName: 'A_INACTIVE',
					},
				],
			})
		})

		it('returns storage errors when reference reads fail', async () => {
			const options = createTestCoreServices()
			seedSecret(options.tx, '01k00000000000000000000040')
			options.tx.repositories.fail.list = true
			const query = createListSecretReferencesQuery(options)

			const result = await query({ secretId: '01k00000000000000000000040' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'repository' } },
			})
		})
	})

	function seedSecretReferenceFixtures(options: ReturnType<typeof createTestCoreServices>): void {
		options.tx.repositories.records.set('01k00000000000000000000034', {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
			created: stamp,
		})
		options.tx.repositories.records.set('01k00000000000000000000035', {
			id: '01k00000000000000000000035',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Other', secretId: '01k00000000000000000000041' },
			created: stamp,
		})
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024', {
			archived: true,
			runtimeRequirements: [
				{ type: 'environment-secret', envName: 'NPM_TOKEN', secretId: '01k00000000000000000000040' },
				{
					type: 'run-command',
					label: 'Install packages',
					command: { executable: 'pnpm', args: ['install'], cwd: '/workspace/repos/repository-1' },
					root: false,
					commandSecretEnv: { NPM_TOKEN: '01k00000000000000000000040', OTHER_TOKEN: '01k00000000000000000000041' },
				},
			],
		})
		options.tx.modelProviders.records.set('01k00000000000000000000027', {
			id: '01k00000000000000000000027',
			name: 'Anthropic',
			source: { type: 'anthropic' },
			auth: { value: { type: 'secret', secretId: '01k00000000000000000000040' } },
			headers: [
				{ name: 'X-Team', value: { type: 'secret', secretId: '01k00000000000000000000040' } },
				{ name: 'X-Other', value: { type: 'secret', secretId: '01k00000000000000000000041' } },
			],
			providerOptions: null,
			created: stamp,
			updated: null,
			archivePeriods: [{ archived: stamp, unarchived: null }],
		})
	}
}
