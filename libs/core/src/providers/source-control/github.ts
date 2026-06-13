import { Octokit } from '@octokit/rest'

import type {
	SourceControlArtifactCreation,
	SourceControlArtifactCreationFailureReason,
	SourceControlProvider,
	SourceControlProviderCreateArtifactBranchInput,
	SourceControlProviderPreflightRepositoryInput,
	SourceControlProviderRepositoryPreflight,
} from './types'
import type { GitHubRepositoryConfig } from '../../domain/repository'

export type GitHubSourceControlProvider = SourceControlProvider<GitHubRepositoryConfig>

export type GitHubCompareStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

export interface GitHubRepositoryClient {
	getRepository(input: { owner: string; name: string }): Promise<void>
	getBranchHead(input: { owner: string; name: string; branch: string }): Promise<string>
	getBranchIfExists(input: { owner: string; name: string; branch: string }): Promise<string | null>
	createBranch(input: { owner: string; name: string; branch: string; sha: string }): Promise<void>
	updateBranch(input: { owner: string; name: string; branch: string; sha: string }): Promise<void>
	compareCommits(input: { owner: string; name: string; baseSha: string; headSha: string }): Promise<GitHubCompareStatus>
}

export type GitHubRepositoryClientFactory = (input: { accessToken: string }) => GitHubRepositoryClient

export interface GitHubSourceControlProviderDependencies {
	createRepositoryClient?: GitHubRepositoryClientFactory
}

export function createGitHubSourceControlProvider(dependencies: GitHubSourceControlProviderDependencies = {}): GitHubSourceControlProvider {
	const createRepositoryClient = dependencies.createRepositoryClient ?? createOctokitRepositoryClient

	return {
		preflightRepository(input) {
			return preflightRepository(createRepositoryClient, input)
		},
		createArtifactBranch(input) {
			return createArtifactBranch(createRepositoryClient, input)
		},
	}
}

async function preflightRepository(
	createRepositoryClient: GitHubRepositoryClientFactory,
	input: SourceControlProviderPreflightRepositoryInput<GitHubRepositoryConfig>,
): Promise<SourceControlProviderRepositoryPreflight> {
	try {
		const client = createRepositoryClient({ accessToken: input.accessToken.plaintext })
		await client.getRepository({ owner: input.repository.config.owner, name: input.repository.config.name })

		return { type: 'passed' }
	} catch (error) {
		return failedPreflight(error)
	}
}

async function createArtifactBranch(
	createRepositoryClient: GitHubRepositoryClientFactory,
	input: SourceControlProviderCreateArtifactBranchInput<GitHubRepositoryConfig>,
): Promise<SourceControlArtifactCreation> {
	const client = createRepositoryClient({ accessToken: input.accessToken.plaintext })
	const repository = { owner: input.repository.config.owner, name: input.repository.config.name }

	const source = await readSourceBranchHead(client, repository, input.sourceBranch)
	if (source.type === 'failed') return source.failure

	const artifact = await readArtifactBranchHead(client, repository, input.artifactBranch)
	if (artifact.type === 'failed') return artifact.failure
	if (artifact.sha === null) return createMissingArtifactBranch(client, repository, input.artifactBranch, source.sha)

	return reconcileExistingArtifactBranch(client, repository, input.sourceBranch, input.artifactBranch, source.sha, artifact.sha)
}

async function readSourceBranchHead(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	branch: string,
): Promise<{ type: 'passed'; sha: string } | { type: 'failed'; failure: SourceControlArtifactCreation }> {
	try {
		return { type: 'passed', sha: await client.getBranchHead({ ...repository, branch }) }
	} catch (error) {
		return { type: 'failed', failure: failedArtifactCreation(error, { operation: 'read-source', sourceBranch: branch }) }
	}
}

async function readArtifactBranchHead(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	branch: string,
): Promise<{ type: 'passed'; sha: string | null } | { type: 'failed'; failure: SourceControlArtifactCreation }> {
	try {
		return { type: 'passed', sha: await client.getBranchIfExists({ ...repository, branch }) }
	} catch (error) {
		return { type: 'failed', failure: failedArtifactCreation(error, { operation: 'read-artifact', artifactBranch: branch }) }
	}
}

async function createMissingArtifactBranch(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	artifactBranch: string,
	sourceSha: string,
): Promise<SourceControlArtifactCreation> {
	try {
		await client.createBranch({ ...repository, branch: artifactBranch, sha: sourceSha })
		return { type: 'passed', mode: 'created', summary: 'GitHub artifact branch created.' }
	} catch (error) {
		return failedArtifactCreation(error, { operation: 'update-artifact', artifactBranch })
	}
}

async function reconcileExistingArtifactBranch(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	artifactBranch: string,
	sourceSha: string,
	artifactSha: string,
): Promise<SourceControlArtifactCreation> {
	if (sourceSha === artifactSha) return { type: 'passed', mode: 'adopted-existing', summary: 'GitHub artifact branch already existed.' }

	try {
		const comparison = await client.compareCommits({ ...repository, baseSha: artifactSha, headSha: sourceSha })
		return reconcileComparedArtifactBranch(comparison, client, repository, sourceBranch, artifactBranch, sourceSha)
	} catch (error) {
		return failedArtifactCreation(error, { operation: 'compare-artifact', artifactBranch })
	}
}

function reconcileComparedArtifactBranch(
	comparison: GitHubCompareStatus,
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	artifactBranch: string,
	sourceSha: string,
): Promise<SourceControlArtifactCreation> | SourceControlArtifactCreation {
	const compared = existingArtifactBranchOutcome(comparison, artifactBranch, sourceBranch)
	return compared === 'fast-forward' ? fastForwardArtifactBranch(client, repository, artifactBranch, sourceSha) : compared
}

function existingArtifactBranchOutcome(
	comparison: GitHubCompareStatus,
	artifactBranch: string,
	sourceBranch: string,
): SourceControlArtifactCreation | 'fast-forward' {
	const outcomes: Record<GitHubCompareStatus, SourceControlArtifactCreation | 'fast-forward'> = {
		identical: failedArtifactBranchDiverged(artifactBranch, sourceBranch),
		ahead: 'fast-forward',
		behind: { type: 'passed', mode: 'adopted-existing', summary: 'GitHub artifact branch already existed.' },
		diverged: failedArtifactBranchDiverged(artifactBranch, sourceBranch),
	}

	return outcomes[comparison]
}

async function fastForwardArtifactBranch(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	artifactBranch: string,
	sourceSha: string,
): Promise<SourceControlArtifactCreation> {
	try {
		await client.updateBranch({ ...repository, branch: artifactBranch, sha: sourceSha })
		return { type: 'passed', mode: 'fast-forwarded-existing', summary: 'GitHub artifact branch fast-forwarded.' }
	} catch (error) {
		return failedArtifactCreation(error, { operation: 'update-artifact', artifactBranch })
	}
}

function createOctokitRepositoryClient(input: { accessToken: string }): GitHubRepositoryClient {
	const octokit = new Octokit({ auth: input.accessToken })

	return {
		async getRepository(repository) {
			await octokit.rest.repos.get({ owner: repository.owner, repo: repository.name })
		},
		async getBranchHead(input) {
			const response = await octokit.rest.git.getRef({ owner: input.owner, repo: input.name, ref: `heads/${input.branch}` })
			return response.data.object.sha
		},
		async getBranchIfExists(input) {
			try {
				return await this.getBranchHead(input)
			} catch (error) {
				if (statusCode(error) === 404) return null
				throw error
			}
		},
		async createBranch(input) {
			await octokit.rest.git.createRef({ owner: input.owner, repo: input.name, ref: `refs/heads/${input.branch}`, sha: input.sha })
		},
		async updateBranch(input) {
			await octokit.rest.git.updateRef({
				owner: input.owner,
				repo: input.name,
				ref: `heads/${input.branch}`,
				sha: input.sha,
				force: false,
			})
		},
		async compareCommits(input) {
			const response = await octokit.rest.repos.compareCommitsWithBasehead({
				owner: input.owner,
				repo: input.name,
				basehead: `${input.baseSha}...${input.headSha}`,
			})
			return gitHubCompareStatus(response.data.status)
		},
	}
}

const gitHubCompareStatuses: Partial<Record<string, GitHubCompareStatus>> = {
	identical: 'identical',
	ahead: 'ahead',
	behind: 'behind',
	diverged: 'diverged',
}

function gitHubCompareStatus(status: string): GitHubCompareStatus {
	return gitHubCompareStatuses[status] ?? 'diverged'
}

function failedPreflight(error: unknown): SourceControlProviderRepositoryPreflight {
	switch (statusCode(error)) {
		case 401:
			return { type: 'failed', reason: { type: 'provider-authentication-failed' } }
		case 403:
			return { type: 'failed', reason: { type: 'provider-access-denied' } }
		case 404:
			return { type: 'failed', reason: { type: 'provider-repository-not-found' } }
		default:
			return { type: 'failed', reason: { type: 'provider-unavailable' } }
	}
}

type ArtifactFailureContext =
	| { operation: 'read-source'; sourceBranch: string }
	| { operation: 'read-artifact'; artifactBranch: string }
	| { operation: 'compare-artifact'; artifactBranch: string }
	| { operation: 'update-artifact'; artifactBranch: string }

function failedArtifactCreation(error: unknown, context: ArtifactFailureContext): SourceControlArtifactCreation {
	return failedArtifactCreationForReason(failedArtifactCreationReason(error, context))
}

function failedArtifactCreationReason(error: unknown, context: ArtifactFailureContext): SourceControlArtifactCreationFailureReason {
	const mapper = artifactFailureReasonMappers[statusCode(error) ?? 0] ?? providerUnavailableFailure
	return mapper(context)
}

type ArtifactFailureReasonMapper = (context: ArtifactFailureContext) => SourceControlArtifactCreationFailureReason

const artifactFailureReasonMappers: Record<number, ArtifactFailureReasonMapper> = {
	401: () => ({ type: 'provider-authentication-failed' }),
	403: accessDeniedOrUpdateDeniedFailure,
	404: sourceMissingOrRepositoryMissingFailure,
	422: updateDeniedOrUnavailableFailure,
}

function accessDeniedOrUpdateDeniedFailure(context: ArtifactFailureContext): SourceControlArtifactCreationFailureReason {
	return context.operation === 'update-artifact'
		? { type: 'artifact-branch-update-denied', branch: context.artifactBranch }
		: { type: 'provider-access-denied' }
}

function sourceMissingOrRepositoryMissingFailure(context: ArtifactFailureContext): SourceControlArtifactCreationFailureReason {
	return context.operation === 'read-source'
		? { type: 'source-branch-not-found', branch: context.sourceBranch }
		: { type: 'provider-repository-not-found' }
}

function updateDeniedOrUnavailableFailure(context: ArtifactFailureContext): SourceControlArtifactCreationFailureReason {
	return context.operation === 'update-artifact'
		? { type: 'artifact-branch-update-denied', branch: context.artifactBranch }
		: providerUnavailableFailure()
}

function providerUnavailableFailure(): SourceControlArtifactCreationFailureReason {
	return { type: 'provider-unavailable' }
}

function failedArtifactBranchDiverged(branch: string, sourceBranch: string): SourceControlArtifactCreation {
	return failedArtifactCreationForReason({ type: 'artifact-branch-diverged', branch, sourceBranch })
}

function failedArtifactCreationForReason(reason: SourceControlArtifactCreationFailureReason): SourceControlArtifactCreation {
	return { type: 'failed', reason, summary: artifactCreationFailureSummary(reason) }
}

const artifactCreationFailureSummaries: Record<SourceControlArtifactCreationFailureReason['type'], string> = {
	'repository-access-secret-unresolved': 'GitHub repository access Secret value could not be resolved.',
	'provider-authentication-failed': 'GitHub artifact branch authentication failed.',
	'provider-access-denied': 'GitHub artifact branch access was denied.',
	'provider-repository-not-found': 'GitHub repository was not found.',
	'source-branch-not-found': 'GitHub artifact source branch was not found.',
	'artifact-branch-diverged': 'GitHub artifact branch diverged from its source branch.',
	'artifact-branch-update-denied': 'GitHub artifact branch could not be updated.',
	'provider-unavailable': 'GitHub artifact branch operation failed.',
}

function artifactCreationFailureSummary(reason: SourceControlArtifactCreationFailureReason): string {
	return artifactCreationFailureSummaries[reason.type]
}

function statusCode(error: unknown): number | null {
	const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null
	return typeof status === 'number' ? status : null
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('GitHub Source Control Provider', () => {
		it('passes repository preflight when the repository can be read', async () => {
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: passingClient })

			await expect(provider.preflightRepository(gitHubPreflightInput())).resolves.toEqual({ type: 'passed' })
		})

		it.each([
			[401, 'provider-authentication-failed'],
			[403, 'provider-access-denied'],
			[404, 'provider-repository-not-found'],
			[500, 'provider-unavailable'],
			[null, 'provider-unavailable'],
		] as const)('maps GitHub status %s to %s', async (status, reason) => {
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: failingClient(status) })

			await expect(provider.preflightRepository(gitHubPreflightInput())).resolves.toEqual({
				type: 'failed',
				reason: { type: reason },
			})
		})

		it('creates an artifact branch at the source branch head when missing', async () => {
			const client = artifactClient({ sourceSha: 'source-sha', artifactSha: null })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'passed',
				mode: 'created',
				summary: 'GitHub artifact branch created.',
			})
			expect(client.calls).toContainEqual(['createBranch', 'artifact', 'source-sha'])
		})

		it('adopts an existing artifact branch when equal to the source branch', async () => {
			const client = artifactClient({ sourceSha: 'same-sha', artifactSha: 'same-sha' })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'passed',
				mode: 'adopted-existing',
				summary: 'GitHub artifact branch already existed.',
			})
			expect(client.calls.some((call) => call[0] === 'updateBranch')).toBe(false)
		})

		it('fast-forwards an existing artifact branch when it is behind the source branch', async () => {
			const client = artifactClient({ sourceSha: 'source-sha', artifactSha: 'artifact-sha', comparison: 'ahead' })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'passed',
				mode: 'fast-forwarded-existing',
				summary: 'GitHub artifact branch fast-forwarded.',
			})
			expect(client.calls).toContainEqual(['updateBranch', 'artifact', 'source-sha'])
		})

		it('adopts an existing artifact branch when it is ahead of the source branch', async () => {
			const client = artifactClient({ sourceSha: 'source-sha', artifactSha: 'artifact-sha', comparison: 'behind' })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'passed',
				mode: 'adopted-existing',
				summary: 'GitHub artifact branch already existed.',
			})
		})

		it('fails when the existing artifact branch diverged from the source branch', async () => {
			const client = artifactClient({ sourceSha: 'source-sha', artifactSha: 'artifact-sha', comparison: 'diverged' })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'failed',
				reason: { type: 'artifact-branch-diverged', branch: 'artifact', sourceBranch: 'main' },
				summary: 'GitHub artifact branch diverged from its source branch.',
			})
		})

		it('fails when the source branch is missing', async () => {
			const client = artifactClient({ sourceSha: Object.assign(new Error('missing'), { status: 404 }), artifactSha: null })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createArtifactBranch(gitHubArtifactInput())).resolves.toEqual({
				type: 'failed',
				reason: { type: 'source-branch-not-found', branch: 'main' },
				summary: 'GitHub artifact source branch was not found.',
			})
		})
	})

	function gitHubPreflightInput(): SourceControlProviderPreflightRepositoryInput<GitHubRepositoryConfig> {
		return {
			repository: gitHubRepository(),
			accessToken: { type: 'access-token', plaintext: 'token' },
		}
	}

	function gitHubArtifactInput(): SourceControlProviderCreateArtifactBranchInput<GitHubRepositoryConfig> {
		return {
			repository: gitHubRepository(),
			accessToken: { type: 'access-token', plaintext: 'token' },
			sourceBranch: 'main',
			artifactBranch: 'artifact',
		}
	}

	function gitHubRepository() {
		return {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: { origin: 'imported' as const, at: '2026-06-01T00:00:00.000Z' },
		}
	}

	function passingClient(): GitHubRepositoryClient {
		return { ...artifactClient({ sourceSha: 'source-sha', artifactSha: null }), getRepository: () => Promise.resolve() }
	}

	function failingClient(status: number | null): GitHubRepositoryClientFactory {
		return () => ({
			...artifactClient({ sourceSha: 'source-sha', artifactSha: null }),
			getRepository: () => Promise.reject(status === null ? new Error('failed') : Object.assign(new Error('failed'), { status })),
		})
	}

	function artifactClient(options: { sourceSha: string | Error; artifactSha: string | null; comparison?: GitHubCompareStatus }) {
		const calls: Array<[string, ...string[]]> = []
		return {
			calls,
			getRepository: () => Promise.resolve(),
			getBranchHead: (input: { branch: string }) => {
				calls.push(['getBranchHead', input.branch])
				return options.sourceSha instanceof Error ? Promise.reject(options.sourceSha) : Promise.resolve(options.sourceSha)
			},
			getBranchIfExists: (input: { branch: string }) => {
				calls.push(['getBranchIfExists', input.branch])
				return Promise.resolve(options.artifactSha)
			},
			createBranch: (input: { branch: string; sha: string }) => {
				calls.push(['createBranch', input.branch, input.sha])
				return Promise.resolve()
			},
			updateBranch: (input: { branch: string; sha: string }) => {
				calls.push(['updateBranch', input.branch, input.sha])
				return Promise.resolve()
			},
			compareCommits: () => {
				calls.push(['compareCommits'])
				return Promise.resolve(options.comparison ?? 'identical')
			},
		} satisfies GitHubRepositoryClient & { calls: Array<[string, ...string[]]> }
	}
}
