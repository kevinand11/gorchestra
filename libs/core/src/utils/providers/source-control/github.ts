import { Octokit } from '@octokit/rest'

import type {
	SourceControlArtifactCreation,
	SourceControlArtifactCreationFailureReason,
	SourceControlBranchOperationFailureReason,
	SourceControlProvider,
	SourceControlProviderCreateArtifactBranchInput,
	SourceControlProviderCreateReviewSurfaceInput,
	SourceControlProviderPreflightRepositoryInput,
	SourceControlProviderRepositoryPreflight,
	SourceControlReviewSurfaceCreation,
} from './types'
import type { GitHubRepositoryConfig } from '../../../domain/repository'

export type GitHubSourceControlProvider = SourceControlProvider<GitHubRepositoryConfig>

export type GitHubCompareStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

export interface GitHubRepositoryClient {
	getRepository(input: { owner: string; name: string }): Promise<void>
	getBranchHead(input: { owner: string; name: string; branch: string }): Promise<string>
	getBranchIfExists(input: { owner: string; name: string; branch: string }): Promise<string | null>
	createBranch(input: { owner: string; name: string; branch: string; sha: string }): Promise<void>
	updateBranch(input: { owner: string; name: string; branch: string; sha: string }): Promise<void>
	compareCommits(input: { owner: string; name: string; baseSha: string; headSha: string }): Promise<GitHubCompareStatus>
	listOpenPullRequests(input: {
		owner: string
		name: string
		sourceBranch: string
		targetBranch: string
	}): Promise<Array<{ number: number }>>
	createPullRequest(input: {
		owner: string
		name: string
		sourceBranch: string
		targetBranch: string
		title: string
	}): Promise<{ number: number }>
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
		createReviewSurface(input) {
			return createReviewSurface(createRepositoryClient, input)
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

async function createReviewSurface(
	createRepositoryClient: GitHubRepositoryClientFactory,
	input: SourceControlProviderCreateReviewSurfaceInput<GitHubRepositoryConfig>,
): Promise<SourceControlReviewSurfaceCreation> {
	const client = createRepositoryClient({ accessToken: input.accessToken.plaintext })
	const repository = { owner: input.repository.config.owner, name: input.repository.config.name }
	const integration = await branchIntegration(client, repository, input.sourceBranch, input.targetBranch)
	if (integration.type !== 'not-integrated') return integration

	const existing = await openPullRequest(client, repository, input.sourceBranch, input.targetBranch)
	if (existing.type !== 'missing') return existing

	return createMissingPullRequest(client, repository, input)
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

type BranchIntegration = { type: 'not-integrated' } | Extract<SourceControlReviewSurfaceCreation, { type: 'integrated' | 'failed' }>

async function branchIntegration(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	targetBranch: string,
): Promise<BranchIntegration> {
	const heads = await reviewSurfaceBranchHeads(client, repository, sourceBranch, targetBranch)
	if (!heads.ok) return heads.failure

	return integratedBranchComparison(client, repository, heads.sourceSha, heads.targetSha)
}

async function reviewSurfaceBranchHeads(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	targetBranch: string,
): Promise<
	| { ok: true; sourceSha: string; targetSha: string }
	| { ok: false; failure: Extract<SourceControlReviewSurfaceCreation, { type: 'failed' }> }
> {
	const source = await readReviewSurfaceBranchHead(client, repository, sourceBranch, 'source')
	if (!source.ok) return source

	const target = await readReviewSurfaceBranchHead(client, repository, targetBranch, 'target')
	return target.ok ? { ok: true, sourceSha: source.sha, targetSha: target.sha } : target
}

async function readReviewSurfaceBranchHead(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	branch: string,
	role: 'source' | 'target',
): Promise<{ ok: true; sha: string } | { ok: false; failure: Extract<SourceControlReviewSurfaceCreation, { type: 'failed' }> }> {
	try {
		return { ok: true, sha: await client.getBranchHead({ ...repository, branch }) }
	} catch (error) {
		return {
			ok: false,
			failure: failedReviewSurfaceCreation(error, { operation: role === 'source' ? 'read-source' : 'read-target', branch }),
		}
	}
}

async function integratedBranchComparison(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceSha: string,
	targetSha: string,
): Promise<BranchIntegration> {
	try {
		return integratedComparison(await client.compareCommits({ ...repository, baseSha: targetSha, headSha: sourceSha }))
	} catch (error) {
		return failedReviewSurfaceCreation(error, { operation: 'compare' })
	}
}

function integratedComparison(comparison: GitHubCompareStatus): BranchIntegration {
	return comparison === 'identical' || comparison === 'behind'
		? { type: 'integrated', summary: 'GitHub source branch is already integrated into target branch.' }
		: { type: 'not-integrated' }
}

type OpenPullRequest = { type: 'missing' } | Extract<SourceControlReviewSurfaceCreation, { type: 'review-surface' | 'failed' }>

async function openPullRequest(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	targetBranch: string,
): Promise<OpenPullRequest> {
	try {
		const pullRequest = firstOpenPullRequest(await client.listOpenPullRequests({ ...repository, sourceBranch, targetBranch }))
		return pullRequest === null ? { type: 'missing' } : adoptedPullRequest(pullRequest.number)
	} catch (error) {
		return failedReviewSurfaceCreation(error, { operation: 'list-pull-requests' })
	}
}

function firstOpenPullRequest(pullRequests: Array<{ number: number }>): { number: number } | null {
	return [...pullRequests].sort((left, right) => left.number - right.number)[0] ?? null
}

function adoptedPullRequest(pullRequestNumber: number): Extract<SourceControlReviewSurfaceCreation, { type: 'review-surface' }> {
	return {
		type: 'review-surface',
		mode: 'adopted-existing',
		pullRequestNumber,
		summary: 'GitHub pull request already existed.',
	}
}

async function createMissingPullRequest(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	input: SourceControlProviderCreateReviewSurfaceInput<GitHubRepositoryConfig>,
): Promise<SourceControlReviewSurfaceCreation> {
	try {
		const pullRequest = await client.createPullRequest({
			...repository,
			sourceBranch: input.sourceBranch,
			targetBranch: input.targetBranch,
			title: input.title,
		})
		return createdPullRequest(pullRequest.number)
	} catch (error) {
		return createPullRequestFailure(client, repository, input.sourceBranch, input.targetBranch, error)
	}
}

function createdPullRequest(pullRequestNumber: number): SourceControlReviewSurfaceCreation {
	return { type: 'review-surface', mode: 'created', pullRequestNumber, summary: 'GitHub pull request created.' }
}

async function createPullRequestFailure(
	client: GitHubRepositoryClient,
	repository: { owner: string; name: string },
	sourceBranch: string,
	targetBranch: string,
	error: unknown,
): Promise<SourceControlReviewSurfaceCreation> {
	if (statusCode(error) !== 422) return failedReviewSurfaceCreation(error, { operation: 'create-pull-request' })

	const existing = await openPullRequest(client, repository, sourceBranch, targetBranch)
	return existing.type === 'missing' ? failedReviewSurfaceCreation(error, { operation: 'create-pull-request' }) : existing
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
		async listOpenPullRequests(input) {
			const response = await octokit.rest.pulls.list({
				owner: input.owner,
				repo: input.name,
				state: 'open',
				head: `${input.owner}:${input.sourceBranch}`,
				base: input.targetBranch,
			})
			return response.data.map((pullRequest) => ({ number: pullRequest.number }))
		},
		async createPullRequest(input) {
			const response = await octokit.rest.pulls.create({
				owner: input.owner,
				repo: input.name,
				head: input.sourceBranch,
				base: input.targetBranch,
				title: input.title,
			})
			return { number: response.data.number }
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

function reviewSurfaceProviderUnavailableFailure(): SourceControlBranchOperationFailureReason {
	return { type: 'provider-unavailable' }
}

function failedArtifactBranchDiverged(branch: string, sourceBranch: string): SourceControlArtifactCreation {
	return failedArtifactCreationForReason({ type: 'artifact-branch-diverged', branch, sourceBranch })
}

function failedArtifactCreationForReason(reason: SourceControlArtifactCreationFailureReason): SourceControlArtifactCreation {
	return { type: 'failed', reason, summary: artifactCreationFailureSummary(reason) }
}

function artifactCreationFailureSummary(reason: SourceControlArtifactCreationFailureReason): string {
	switch (reason.type) {
		case 'repository-access-secret-unresolved':
			return 'GitHub repository access Secret value could not be resolved.'
		case 'provider-authentication-failed':
			return 'GitHub artifact branch authentication failed.'
		case 'provider-access-denied':
			return 'GitHub artifact branch access was denied.'
		case 'provider-repository-not-found':
			return 'GitHub repository was not found.'
		case 'source-branch-not-found':
			return 'GitHub artifact source branch was not found.'
		case 'target-branch-not-found':
			return 'GitHub artifact target branch was not found.'
		case 'artifact-branch-diverged':
			return 'GitHub artifact branch diverged from its source branch.'
		case 'artifact-branch-update-denied':
			return 'GitHub artifact branch could not be updated.'
		case 'provider-unavailable':
			return 'GitHub artifact branch operation failed.'
		default:
			throw new Error(`Unexpected GitHub artifact creation failure reason: ${String(reason satisfies never)}`)
	}
}

type ReviewSurfaceFailureContext =
	| { operation: 'read-source'; branch: string }
	| { operation: 'read-target'; branch: string }
	| { operation: 'compare' }
	| { operation: 'list-pull-requests' }
	| { operation: 'create-pull-request' }

function failedReviewSurfaceCreation(
	error: unknown,
	context: ReviewSurfaceFailureContext,
): Extract<SourceControlReviewSurfaceCreation, { type: 'failed' }> {
	return failedReviewSurfaceCreationForReason(reviewSurfaceFailureReason(error, context))
}

function reviewSurfaceFailureReason(error: unknown, context: ReviewSurfaceFailureContext): SourceControlBranchOperationFailureReason {
	const mapper = reviewSurfaceFailureReasonMappers[statusCode(error) ?? 0] ?? reviewSurfaceProviderUnavailableFailure
	return mapper(context)
}

type ReviewSurfaceFailureReasonMapper = (context: ReviewSurfaceFailureContext) => SourceControlBranchOperationFailureReason

const reviewSurfaceFailureReasonMappers: Record<number, ReviewSurfaceFailureReasonMapper> = {
	401: () => ({ type: 'provider-authentication-failed' }),
	403: () => ({ type: 'provider-access-denied' }),
	404: reviewSurfaceNotFoundFailure,
}

function reviewSurfaceNotFoundFailure(context: ReviewSurfaceFailureContext): SourceControlBranchOperationFailureReason {
	if (context.operation === 'read-source') return { type: 'source-branch-not-found', branch: context.branch }
	if (context.operation === 'read-target') return { type: 'target-branch-not-found', branch: context.branch }

	return { type: 'provider-repository-not-found' }
}

function failedReviewSurfaceCreationForReason(
	reason: SourceControlBranchOperationFailureReason,
): Extract<SourceControlReviewSurfaceCreation, { type: 'failed' }> {
	return { type: 'failed', reason, summary: reviewSurfaceFailureSummary(reason) }
}

function reviewSurfaceFailureSummary(reason: SourceControlBranchOperationFailureReason): string {
	switch (reason.type) {
		case 'repository-access-secret-unresolved':
			return 'GitHub repository access Secret value could not be resolved.'
		case 'provider-authentication-failed':
			return 'GitHub review surface authentication failed.'
		case 'provider-access-denied':
			return 'GitHub review surface access was denied.'
		case 'provider-repository-not-found':
			return 'GitHub repository was not found.'
		case 'source-branch-not-found':
			return 'GitHub review surface source branch was not found.'
		case 'target-branch-not-found':
			return 'GitHub review surface target branch was not found.'
		case 'provider-unavailable':
			return 'GitHub review surface operation failed.'
		default:
			throw new Error(`Unexpected GitHub review surface failure reason: ${String(reason satisfies never)}`)
	}
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

		it('reports an integrated review surface when the source branch is already in the target branch', async () => {
			const client = artifactClient({ sourceSha: 'source-sha', targetSha: 'target-sha', artifactSha: null, comparison: 'behind' })
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createReviewSurface(gitHubReviewSurfaceInput())).resolves.toEqual({
				type: 'integrated',
				summary: 'GitHub source branch is already integrated into target branch.',
			})
			expect(client.calls.some((call) => call[0] === 'createPullRequest')).toBe(false)
		})

		it('adopts the lowest-numbered open pull request for a review surface', async () => {
			const client = artifactClient({
				sourceSha: 'source-sha',
				targetSha: 'target-sha',
				artifactSha: null,
				comparison: 'ahead',
				pullRequests: [{ number: 3 }, { number: 2 }],
			})
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createReviewSurface(gitHubReviewSurfaceInput())).resolves.toEqual({
				type: 'review-surface',
				mode: 'adopted-existing',
				pullRequestNumber: 2,
				summary: 'GitHub pull request already existed.',
			})
		})

		it('creates a pull request for a review surface when branches are not integrated', async () => {
			const client = artifactClient({
				sourceSha: 'source-sha',
				targetSha: 'target-sha',
				artifactSha: null,
				comparison: 'ahead',
				createdPullRequestNumber: 7,
			})
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createReviewSurface(gitHubReviewSurfaceInput())).resolves.toEqual({
				type: 'review-surface',
				mode: 'created',
				pullRequestNumber: 7,
				summary: 'GitHub pull request created.',
			})
			expect(client.calls).toContainEqual(['createPullRequest', 'main', 'delivery', 'Review'])
		})

		it('adopts an open pull request after a duplicate create failure', async () => {
			const client = artifactClient({
				sourceSha: 'source-sha',
				targetSha: 'target-sha',
				artifactSha: null,
				comparison: 'ahead',
				pullRequestsAfterCreateFailure: [{ number: 8 }],
				createPullRequestError: Object.assign(new Error('duplicate'), { status: 422 }),
			})
			const provider = createGitHubSourceControlProvider({ createRepositoryClient: () => client })

			await expect(provider.createReviewSurface(gitHubReviewSurfaceInput())).resolves.toEqual({
				type: 'review-surface',
				mode: 'adopted-existing',
				pullRequestNumber: 8,
				summary: 'GitHub pull request already existed.',
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
			operationId: '01k00000000000000000000090',
			repository: gitHubRepository(),
			accessToken: { type: 'access-token', plaintext: 'token' },
			sourceBranch: 'main',
			artifactBranch: 'artifact',
		}
	}

	function gitHubReviewSurfaceInput(): SourceControlProviderCreateReviewSurfaceInput<GitHubRepositoryConfig> {
		return {
			operationId: '01k00000000000000000000090',
			repository: gitHubRepository(),
			accessToken: { type: 'access-token', plaintext: 'token' },
			sourceBranch: 'main',
			targetBranch: 'delivery',
			title: 'Review',
		}
	}

	function gitHubRepository() {
		return {
			id: '01k00000000000000000000034',
			projectId: '01k00000000000000000000030',
			config: { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
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

	function artifactClient(options: {
		sourceSha: string | Error
		artifactSha: string | null
		targetSha?: string | Error
		comparison?: GitHubCompareStatus
		pullRequests?: Array<{ number: number }>
		pullRequestsAfterCreateFailure?: Array<{ number: number }>
		createdPullRequestNumber?: number
		createPullRequestError?: Error
	}) {
		const calls: Array<[string, ...string[]]> = []
		return {
			calls,
			getRepository: () => Promise.resolve(),
			getBranchHead: (input: { branch: string }) => {
				calls.push(['getBranchHead', input.branch])
				const sha = input.branch === 'delivery' ? (options.targetSha ?? options.sourceSha) : options.sourceSha
				return sha instanceof Error ? Promise.reject(sha) : Promise.resolve(sha)
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
			listOpenPullRequests: (input: { sourceBranch: string; targetBranch: string }) => {
				calls.push(['listOpenPullRequests', input.sourceBranch, input.targetBranch])
				return Promise.resolve(
					calls.some((call) => call[0] === 'createPullRequest')
						? (options.pullRequestsAfterCreateFailure ?? [])
						: (options.pullRequests ?? []),
				)
			},
			createPullRequest: (input: { sourceBranch: string; targetBranch: string; title: string }) => {
				calls.push(['createPullRequest', input.sourceBranch, input.targetBranch, input.title])
				return options.createPullRequestError === undefined
					? Promise.resolve({ number: options.createdPullRequestNumber ?? 1 })
					: Promise.reject(options.createPullRequestError)
			},
		} satisfies GitHubRepositoryClient & { calls: Array<[string, ...string[]]> }
	}
}
