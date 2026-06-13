import { createGitHubSourceControlProvider, type GitHubSourceControlProvider } from './github'
import type {
	GitHubRepository,
	SourceControlAccessToken,
	SourceControlArtifactCreation,
	SourceControlArtifactCreationError,
	SourceControlCreateDeliveryArtifactInput,
	SourceControlCreateSliceArtifactInput,
	SourceControlProviders,
	SourceControlRepositoryPreflight,
	SourceControlRepositoryPreflightError,
	SourceControlRepositoryPreflightFailureReason,
} from './types'
import type { Id } from '../../domain/commons'
import type { Repository } from '../../domain/repository'
import { resolvedSecretValuesPipe, type CoreServices, type ResolvedSecretValues } from '../../services'
import type { Result } from '../../utils/types'
import { validateCoreServiceOutput } from '../../validation'

export interface SourceControlProviderImplementations {
	github?: GitHubSourceControlProvider
}

export function createSourceControlProviders(
	services: CoreServices,
	implementations: SourceControlProviderImplementations = {},
): SourceControlProviders {
	const github = implementations.github ?? createGitHubSourceControlProvider()

	return {
		preflightRepository(input) {
			switch (input.repository.config.provider) {
				case 'github':
					return preflightGitHubRepository(services, github, input.repository)
			}
		},
		createDeliveryArtifact(input) {
			switch (input.repository.config.provider) {
				case 'github':
					return createGitHubDeliveryArtifact(services, github, { ...input, repository: input.repository })
			}
		},
		createSliceArtifact(input) {
			switch (input.repository.config.provider) {
				case 'github':
					return createGitHubSliceArtifact(services, github, { ...input, repository: input.repository })
			}
		},
	}
}

async function createGitHubDeliveryArtifact(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	input: SourceControlCreateDeliveryArtifactInput & { repository: GitHubRepository },
): Promise<Result<SourceControlArtifactCreation, SourceControlArtifactCreationError>> {
	const accessToken = await resolveRepositoryAccessToken(services, input.repository.config.secretId)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: artifactCreationAccessFailure(accessToken.value) }

	const creation = await github.createArtifactBranch({
		repository: input.repository,
		accessToken: accessToken.value,
		sourceBranch: input.sourceBranch,
		artifactBranch: input.deliveryBranch,
	})

	return { ok: true, value: creation }
}

async function createGitHubSliceArtifact(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	input: SourceControlCreateSliceArtifactInput & { repository: GitHubRepository },
): Promise<Result<SourceControlArtifactCreation, SourceControlArtifactCreationError>> {
	const accessToken = await resolveRepositoryAccessToken(services, input.repository.config.secretId)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: artifactCreationAccessFailure(accessToken.value) }

	const creation = await github.createArtifactBranch({
		repository: input.repository,
		accessToken: accessToken.value,
		sourceBranch: input.sourceBranch,
		artifactBranch: input.sliceBranch,
	})

	return { ok: true, value: creation }
}

async function preflightGitHubRepository(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	repository: GitHubRepository,
): Promise<Result<SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>> {
	const accessToken = await resolveRepositoryAccessToken(services, repository.config.secretId)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: accessToken.value }

	const providerPreflight = await github.preflightRepository({ repository, accessToken: accessToken.value })
	return { ok: true, value: gitHubRepositoryPreflight(providerPreflight) }
}

type SecretValueResolution = { type: 'resolved'; output: unknown } | { type: 'failed'; preflight: SourceControlRepositoryPreflight }

async function resolveRepositoryAccessToken(
	services: CoreServices,
	secretId: Id,
): Promise<Result<SourceControlAccessToken | SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>> {
	const resolution = await resolveSecretValueOutput(services, secretId)
	return resolution.ok ? accessTokenFromSecretValueResolution(resolution.value, secretId) : resolution
}

async function resolveSecretValueOutput(
	services: CoreServices,
	secretId: Id,
): Promise<Result<SecretValueResolution, SourceControlRepositoryPreflightError>> {
	try {
		return { ok: true, value: { type: 'resolved', output: await services.secrets.resolveSecretValues({ secretIds: [secretId] }) } }
	} catch {
		return { ok: true, value: { type: 'failed', preflight: unresolvedAccessSecretPreflight(secretId) } }
	}
}

function accessTokenFromSecretValueResolution(
	resolution: SecretValueResolution,
	secretId: Id,
): Result<SourceControlAccessToken | SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError> {
	return resolution.type === 'failed'
		? { ok: true, value: resolution.preflight }
		: accessTokenFromResolvedSecretValues(resolution.output, secretId)
}

function accessTokenFromResolvedSecretValues(
	output: unknown,
	secretId: Id,
): Result<SourceControlAccessToken | SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError> {
	const shapeValidation = validateCoreServiceOutput(resolvedSecretValuesPipe, output, 'secrets', 'resolveSecretValues')
	if (!shapeValidation.ok) return shapeValidation

	return exactAccessToken(secretId, shapeValidation.value)
}

function exactAccessToken(
	secretId: Id,
	values: ResolvedSecretValues,
): Result<SourceControlAccessToken | SourceControlRepositoryPreflight, never> {
	const plaintext = values[secretId]
	return plaintext === undefined
		? { ok: true, value: unresolvedAccessSecretPreflight(secretId) }
		: { ok: true, value: { type: 'access-token', plaintext } }
}

function gitHubRepositoryPreflight(
	preflight: { type: 'passed' } | { type: 'failed'; reason: SourceControlRepositoryPreflightFailureReason },
): SourceControlRepositoryPreflight {
	return preflight.type === 'passed'
		? { type: 'passed', summary: 'GitHub repository preflight passed.' }
		: { type: 'failed', reason: preflight.reason, summary: gitHubFailureSummary(preflight.reason) }
}

const gitHubFailureSummaries: Record<SourceControlRepositoryPreflightFailureReason['type'], string> = {
	'repository-access-secret-missing': 'GitHub repository access Secret is missing.',
	'repository-access-secret-inactive': 'GitHub repository access Secret is not active.',
	'repository-access-secret-unresolved': 'GitHub repository access Secret value could not be resolved.',
	'provider-authentication-failed': 'GitHub repository authentication failed.',
	'provider-access-denied': 'GitHub repository access was denied.',
	'provider-repository-not-found': 'GitHub repository was not found.',
	'provider-unavailable': 'GitHub repository preflight failed.',
}

function gitHubFailureSummary(reason: SourceControlRepositoryPreflightFailureReason): string {
	return gitHubFailureSummaries[reason.type]
}

function artifactCreationAccessFailure(preflight: SourceControlRepositoryPreflight): SourceControlArtifactCreation {
	return preflight.type === 'failed' && preflight.reason.type === 'repository-access-secret-unresolved'
		? {
				type: 'failed',
				reason: { type: 'repository-access-secret-unresolved', secretId: preflight.reason.secretId },
				summary: 'GitHub repository access Secret value could not be resolved.',
			}
		: { type: 'failed', reason: { type: 'provider-unavailable' }, summary: 'GitHub artifact branch operation failed.' }
}

function unresolvedAccessSecretPreflight(secretId: Id): SourceControlRepositoryPreflight {
	return gitHubRepositoryPreflight({ type: 'failed', reason: { type: 'repository-access-secret-unresolved', secretId } })
}

function isAccessToken(value: SourceControlAccessToken | SourceControlRepositoryPreflight): value is SourceControlAccessToken {
	return value.type === 'access-token'
}

export type { GitHubSourceControlProvider } from './github'

export type {
	SourceControlAccessToken,
	SourceControlArtifactCreation,
	SourceControlArtifactCreationError,
	SourceControlArtifactCreationFailureReason,
	SourceControlCreateDeliveryArtifactInput,
	SourceControlCreateSliceArtifactInput,
	SourceControlProvider,
	SourceControlProviderCreateArtifactBranchInput,
	SourceControlProviderPreflightRepositoryInput,
	SourceControlProviderRepositoryPreflight,
	SourceControlProviders,
	SourceControlRepositoryPreflight,
	SourceControlRepositoryPreflightError,
	SourceControlRepositoryPreflightFailureReason,
} from './types'

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Source Control Provider family', () => {
		it('resolves GitHub repository access Secrets and dispatches to GitHub', async () => {
			const services = coreServices(() => Promise.resolve({ 'secret-1': 'token' }))
			let observedToken: string | null = null
			const sourceControl = createSourceControlProviders(services, {
				github: {
					preflightRepository(input) {
						observedToken = input.accessToken.plaintext
						return Promise.resolve({ type: 'passed' })
					},
					createArtifactBranch() {
						throw new Error('GitHub provider should not be called.')
					},
				},
			})

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository() })

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'GitHub repository preflight passed.' } })
			expect(observedToken).toBe('token')
		})

		it('returns failed preflight when the Secret service resolves no value', async () => {
			const services = coreServices(() => Promise.resolve({}))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository() })

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'repository-access-secret-unresolved', secretId: 'secret-1' },
					summary: 'GitHub repository access Secret value could not be resolved.',
				},
			})
		})

		it('resolves GitHub repository access Secrets for Delivery Artifact creation', async () => {
			let observedBranch: string | null = null
			let observedToken: string | null = null
			const sourceControl = createSourceControlProviders(
				coreServices(() => Promise.resolve({ 'secret-1': 'token' })),
				{
					github: {
						preflightRepository: () => Promise.resolve({ type: 'passed' }),
						createArtifactBranch(input) {
							observedBranch = input.artifactBranch
							observedToken = input.accessToken.plaintext
							return Promise.resolve({ type: 'passed', mode: 'created', summary: 'created' })
						},
					},
				},
			)

			const result = await sourceControl.createDeliveryArtifact({
				repository: gitHubRepository(),
				sourceBranch: 'main',
				deliveryBranch: 'delivery-branch',
			})

			expect(result).toEqual({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			expect(observedBranch).toBe('delivery-branch')
			expect(observedToken).toBe('token')
		})

		it('returns failed artifact creation when the Repository access Secret value is unresolved', async () => {
			const services = coreServices(() => Promise.resolve({}))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.createDeliveryArtifact({
				repository: gitHubRepository(),
				sourceBranch: 'main',
				deliveryBranch: 'delivery-branch',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'repository-access-secret-unresolved', secretId: 'secret-1' },
					summary: 'GitHub repository access Secret value could not be resolved.',
				},
			})
		})

		it('rejects malformed resolved Secret values as invalid Core Service Output', async () => {
			const services = coreServices(() => Promise.resolve({ 'secret-1': 1 } as never))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository() })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
			})
		})
	})

	function gitHubRepository(): Repository {
		return {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
		}
	}

	function coreServices(resolveSecretValues: CoreServices['secrets']['resolveSecretValues']): CoreServices {
		return {
			storage: {
				preflight: () => Promise.resolve({ ok: true }),
				transaction: () => Promise.reject(new Error('Storage should not be called.')),
			},
			secrets: {
				preflight: () => Promise.resolve({ ok: true }),
				resolveSecrets: () => Promise.resolve([]),
				resolveSecretValues,
			},
			sandbox: { preflight: () => Promise.resolve({ ok: true }) },
			clock: { now: () => new Date('2026-06-10T12:00:00.000Z') },
			idGenerator: { next: (brand) => `${brand}-1` },
		}
	}

	function neverCalledGitHubProvider(): GitHubSourceControlProvider {
		return {
			preflightRepository() {
				throw new Error('GitHub provider should not be called.')
			},
			createArtifactBranch() {
				throw new Error('GitHub provider should not be called.')
			},
		}
	}
}
