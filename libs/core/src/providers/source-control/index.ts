import { createGitHubSourceControlProvider, type GitHubSourceControlProvider } from './github'
import type {
	GitHubRepository,
	SourceControlAccessToken,
	SourceControlArtifactCreation,
	SourceControlArtifactCreationError,
	SourceControlCreateArtifactBranchInput,
	SourceControlCreateReviewSurfaceInput,
	SourceControlProviders,
	SourceControlRepositoryPreflight,
	SourceControlRepositoryPreflightError,
	SourceControlRepositoryPreflightInput,
	SourceControlRepositoryPreflightFailureReason,
	SourceControlReviewSurfaceCreation,
	SourceControlReviewSurfaceCreationError,
} from './types'
import type { Id } from '../../domain/commons'
import type { Repository } from '../../domain/repository'
import type { CoreServices, ResolvableSecretValue } from '../../services'
import { resolveSecretValueRefs } from '../../utils/secret-values'
import type { Result } from '../../utils/types'

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
					return preflightGitHubRepository(services, github, { ...input, repository: input.repository })
			}
		},
		createArtifactBranch(input) {
			switch (input.repository.config.provider) {
				case 'github':
					return createGitHubArtifactBranch(services, github, { ...input, repository: input.repository })
			}
		},
		createReviewSurface(input) {
			switch (input.repository.config.provider) {
				case 'github':
					return createGitHubReviewSurface(services, github, { ...input, repository: input.repository })
			}
		},
	}
}

async function createGitHubArtifactBranch(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	input: SourceControlCreateArtifactBranchInput & { repository: GitHubRepository },
): Promise<Result<SourceControlArtifactCreation, SourceControlArtifactCreationError>> {
	const accessToken = await resolveRepositoryAccessToken(services, input.accessSecret)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: artifactCreationAccessFailure(accessToken.value) }

	const creation = await github.createArtifactBranch({
		repository: input.repository,
		accessToken: accessToken.value,
		sourceBranch: input.sourceBranch,
		artifactBranch: input.artifactBranch,
	})

	return { ok: true, value: creation }
}

async function createGitHubReviewSurface(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	input: SourceControlCreateReviewSurfaceInput & { repository: GitHubRepository },
): Promise<Result<SourceControlReviewSurfaceCreation, SourceControlReviewSurfaceCreationError>> {
	const accessToken = await resolveRepositoryAccessToken(services, input.accessSecret)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: reviewSurfaceAccessFailure(accessToken.value) }

	const creation = await github.createReviewSurface({
		repository: input.repository,
		accessToken: accessToken.value,
		sourceBranch: input.sourceBranch,
		targetBranch: input.targetBranch,
		title: input.title,
	})

	return { ok: true, value: creation }
}

async function preflightGitHubRepository(
	services: CoreServices,
	github: GitHubSourceControlProvider,
	input: SourceControlRepositoryPreflightInput & { repository: GitHubRepository },
): Promise<Result<SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>> {
	const accessToken = await resolveRepositoryAccessToken(services, input.accessSecret)
	if (!accessToken.ok) return accessToken
	if (!isAccessToken(accessToken.value)) return { ok: true, value: accessToken.value }

	const providerPreflight = await github.preflightRepository({ repository: input.repository, accessToken: accessToken.value })
	return { ok: true, value: gitHubRepositoryPreflight(providerPreflight) }
}

async function resolveRepositoryAccessToken(
	services: CoreServices,
	secret: ResolvableSecretValue,
): Promise<Result<SourceControlAccessToken | SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>> {
	const resolution = await resolveSecretValueRefs(services, [secret])
	if (!resolution.ok) return resolution

	const value = resolution.value[secret.secretId]
	return value === undefined || !value.ok
		? { ok: true, value: unresolvedAccessSecretPreflight(secret.secretId) }
		: { ok: true, value: { type: 'access-token', plaintext: value.value } }
}

function gitHubRepositoryPreflight(
	preflight: { type: 'passed' } | { type: 'failed'; reason: SourceControlRepositoryPreflightFailureReason },
): SourceControlRepositoryPreflight {
	return preflight.type === 'passed'
		? { type: 'passed', summary: 'GitHub repository preflight passed.' }
		: { type: 'failed', reason: preflight.reason, summary: gitHubFailureSummary(preflight.reason) }
}

function gitHubFailureSummary(reason: SourceControlRepositoryPreflightFailureReason): string {
	switch (reason.type) {
		case 'repository-access-secret-missing':
			return 'GitHub repository access Secret is missing.'
		case 'repository-access-secret-inactive':
			return 'GitHub repository access Secret is not active.'
		case 'repository-access-secret-unresolved':
			return 'GitHub repository access Secret value could not be resolved.'
		case 'provider-authentication-failed':
			return 'GitHub repository authentication failed.'
		case 'provider-access-denied':
			return 'GitHub repository access was denied.'
		case 'provider-repository-not-found':
			return 'GitHub repository was not found.'
		case 'provider-unavailable':
			return 'GitHub repository preflight failed.'
		default:
			throw new Error(`Unexpected GitHub repository preflight failure reason: ${String(reason satisfies never)}`)
	}
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

function reviewSurfaceAccessFailure(preflight: SourceControlRepositoryPreflight): SourceControlReviewSurfaceCreation {
	return preflight.type === 'failed' && preflight.reason.type === 'repository-access-secret-unresolved'
		? {
				type: 'failed',
				reason: { type: 'repository-access-secret-unresolved', secretId: preflight.reason.secretId },
				summary: 'GitHub repository access Secret value could not be resolved.',
			}
		: { type: 'failed', reason: { type: 'provider-unavailable' }, summary: 'GitHub review surface operation failed.' }
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
	SourceControlCreateArtifactBranchInput,
	SourceControlCreateReviewSurfaceInput,
	SourceControlProvider,
	SourceControlProviderCreateArtifactBranchInput,
	SourceControlProviderCreateReviewSurfaceInput,
	SourceControlProviderPreflightRepositoryInput,
	SourceControlProviderRepositoryPreflight,
	SourceControlProviders,
	SourceControlRepositoryPreflight,
	SourceControlRepositoryPreflightError,
	SourceControlRepositoryPreflightFailureReason,
	SourceControlReviewSurfaceCreation,
	SourceControlReviewSurfaceCreationError,
} from './types'

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Source Control Provider family', () => {
		it('resolves GitHub repository access Secrets and dispatches to GitHub', async () => {
			const services = coreServices(() => Promise.resolve({ '01k00000000000000000000040': 'token' }))
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
					createReviewSurface() {
						throw new Error('GitHub provider should not be called.')
					},
				},
			})

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository(), accessSecret: gitHubAccessSecret() })

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'GitHub repository preflight passed.' } })
			expect(observedToken).toBe('token')
		})

		it('returns failed preflight when the Secret service resolves no value', async () => {
			const services = coreServices(() => Promise.resolve({}))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository(), accessSecret: gitHubAccessSecret() })

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'repository-access-secret-unresolved', secretId: '01k00000000000000000000040' },
					summary: 'GitHub repository access Secret value could not be resolved.',
				},
			})
		})

		it('resolves GitHub repository access Secrets for artifact branch creation', async () => {
			let observedBranch: string | null = null
			let observedToken: string | null = null
			const sourceControl = createSourceControlProviders(
				coreServices(() => Promise.resolve({ '01k00000000000000000000040': 'token' })),
				{
					github: {
						preflightRepository: () => Promise.resolve({ type: 'passed' }),
						createArtifactBranch(input) {
							observedBranch = input.artifactBranch
							observedToken = input.accessToken.plaintext
							return Promise.resolve({ type: 'passed', mode: 'created', summary: 'created' })
						},
						createReviewSurface() {
							throw new Error('GitHub provider should not be called.')
						},
					},
				},
			)

			const result = await sourceControl.createArtifactBranch({
				repository: gitHubRepository(),
				accessSecret: gitHubAccessSecret(),
				sourceBranch: 'main',
				artifactBranch: 'delivery-branch',
			})

			expect(result).toEqual({ ok: true, value: { type: 'passed', mode: 'created', summary: 'created' } })
			expect(observedBranch).toBe('delivery-branch')
			expect(observedToken).toBe('token')
		})

		it('resolves GitHub repository access Secrets for Review Surface creation', async () => {
			let observedToken: string | null = null
			const sourceControl = createSourceControlProviders(
				coreServices(() => Promise.resolve({ '01k00000000000000000000040': 'token' })),
				{
					github: {
						preflightRepository: () => Promise.resolve({ type: 'passed' }),
						createArtifactBranch() {
							throw new Error('GitHub provider should not be called.')
						},
						createReviewSurface(input) {
							observedToken = input.accessToken.plaintext
							return Promise.resolve({ type: 'review-surface', mode: 'created', pullRequestNumber: 1, summary: 'created' })
						},
					},
				},
			)

			const result = await sourceControl.createReviewSurface({
				repository: gitHubRepository(),
				accessSecret: gitHubAccessSecret(),
				sourceBranch: 'delivery-branch',
				targetBranch: 'main',
				title: 'Delivery',
			})

			expect(result).toEqual({
				ok: true,
				value: { type: 'review-surface', mode: 'created', pullRequestNumber: 1, summary: 'created' },
			})
			expect(observedToken).toBe('token')
		})

		it('returns failed artifact creation when the Repository access Secret value is unresolved', async () => {
			const services = coreServices(() => Promise.resolve({}))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.createArtifactBranch({
				repository: gitHubRepository(),
				accessSecret: gitHubAccessSecret(),
				sourceBranch: 'main',
				artifactBranch: 'delivery-branch',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					type: 'failed',
					reason: { type: 'repository-access-secret-unresolved', secretId: '01k00000000000000000000040' },
					summary: 'GitHub repository access Secret value could not be resolved.',
				},
			})
		})

		it('rejects malformed resolved Secret values as invalid Core Service Output', async () => {
			const services = coreServices(() => Promise.resolve({ '01k00000000000000000000040': 1 } as never))
			const sourceControl = createSourceControlProviders(services, { github: neverCalledGitHubProvider() })

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository(), accessSecret: gitHubAccessSecret() })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
			})
		})
	})

	function gitHubRepository(): Repository {
		return {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
		}
	}

	function gitHubAccessSecret(): ResolvableSecretValue {
		return { secretId: '01k00000000000000000000040', valueRef: 'protected-ref' }
	}

	function coreServices(resolveSecretValues: CoreServices['secrets']['resolveSecretValues']): CoreServices {
		return {
			storage: unusedStorageService(),
			secrets: {
				preflight: () => Promise.resolve({ ok: true }),
				resolveSecrets: () => Promise.resolve([]),
				resolveSecretValues,
			},
			sandbox: {
				kind: 'consumer-managed',
				create: () => Promise.resolve(noopSandboxInstance()),
				find: () => Promise.resolve(noopSandboxInstance()),
			},
			dispatcher: {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => Promise.resolve('dispatch-marker'),
				ready: () => {},
			},
		}
	}

	function noopSandboxInstance() {
		return {
			runCommand: () => Promise.resolve({ exitCode: 0, summary: 'Command completed.', stdout: null, stderr: null }),
			readFile: () => Promise.resolve(null),
			writeFile: () => Promise.resolve(),
			release: () => Promise.resolve({ summary: 'Sandbox released.' }),
		}
	}

	function unusedStorageService(): CoreServices['storage'] {
		return {
			on: () => {
				throw new Error('Storage should not be called.')
			},
			session: () => Promise.reject(new Error('Storage should not be called.')),
			resolve: () => Promise.reject(new Error('Storage should not be called.')),
		} as never
	}

	function neverCalledGitHubProvider(): GitHubSourceControlProvider {
		return {
			preflightRepository() {
				throw new Error('GitHub provider should not be called.')
			},
			createArtifactBranch() {
				throw new Error('GitHub provider should not be called.')
			},
			createReviewSurface() {
				throw new Error('GitHub provider should not be called.')
			},
		}
	}
}
