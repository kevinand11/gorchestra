import type { Id } from '../../domain/commons'
import type { GitHubRepositoryConfig, Repository, RepositoryConfig } from '../../domain/repository'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { Result } from '../../utils/types'

export interface SourceControlRepositoryPreflightInput {
	repository: Repository
}

export type SourceControlRepositoryPreflightFailureReason =
	| { type: 'repository-access-secret-missing'; secretId: Id }
	| { type: 'repository-access-secret-inactive'; secretId: Id }
	| { type: 'repository-access-secret-unresolved'; secretId: Id }
	| { type: 'provider-authentication-failed' }
	| { type: 'provider-access-denied' }
	| { type: 'provider-repository-not-found' }
	| { type: 'provider-unavailable' }

export type SourceControlRepositoryPreflight =
	| { type: 'passed'; summary: string }
	| { type: 'failed'; reason: SourceControlRepositoryPreflightFailureReason; summary: string }

export type SourceControlRepositoryPreflightError = InvalidCoreServiceOutputError

export interface SourceControlCreateArtifactBranchInput {
	repository: Repository
	sourceBranch: string
	artifactBranch: string
}

export type SourceControlBranchOperationFailureReason =
	| { type: 'repository-access-secret-unresolved'; secretId: Id }
	| { type: 'provider-authentication-failed' }
	| { type: 'provider-access-denied' }
	| { type: 'provider-repository-not-found' }
	| { type: 'source-branch-not-found'; branch: string }
	| { type: 'target-branch-not-found'; branch: string }
	| { type: 'provider-unavailable' }

export type SourceControlArtifactCreationFailureReason =
	| SourceControlBranchOperationFailureReason
	| { type: 'artifact-branch-diverged'; branch: string; sourceBranch: string }
	| { type: 'artifact-branch-update-denied'; branch: string }

export type SourceControlArtifactCreation =
	| { type: 'passed'; mode: 'created' | 'adopted-existing' | 'fast-forwarded-existing'; summary: string }
	| { type: 'failed'; reason: SourceControlArtifactCreationFailureReason; summary: string }

export type SourceControlArtifactCreationError = InvalidCoreServiceOutputError

export interface SourceControlCreateReviewSurfaceInput {
	repository: Repository
	sourceBranch: string
	targetBranch: string
	title: string
}

export type SourceControlReviewSurfaceCreation =
	| { type: 'integrated'; summary: string }
	| { type: 'review-surface'; mode: 'created' | 'adopted-existing'; pullRequestNumber: number; summary: string }
	| { type: 'failed'; reason: SourceControlBranchOperationFailureReason; summary: string }

export type SourceControlReviewSurfaceCreationError = InvalidCoreServiceOutputError

export interface SourceControlProviders {
	preflightRepository(
		input: SourceControlRepositoryPreflightInput,
	): Promise<Result<SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>>
	createArtifactBranch(
		input: SourceControlCreateArtifactBranchInput,
	): Promise<Result<SourceControlArtifactCreation, SourceControlArtifactCreationError>>
	createReviewSurface(
		input: SourceControlCreateReviewSurfaceInput,
	): Promise<Result<SourceControlReviewSurfaceCreation, SourceControlReviewSurfaceCreationError>>
}

export interface SourceControlAccessToken {
	type: 'access-token'
	plaintext: string
}

export interface SourceControlProviderPreflightRepositoryInput<Config extends RepositoryConfig> {
	repository: Repository & { config: Config }
	accessToken: SourceControlAccessToken
}

export interface SourceControlProviderCreateArtifactBranchInput<Config extends RepositoryConfig> {
	repository: Repository & { config: Config }
	accessToken: SourceControlAccessToken
	sourceBranch: string
	artifactBranch: string
}

export interface SourceControlProviderCreateReviewSurfaceInput<Config extends RepositoryConfig> {
	repository: Repository & { config: Config }
	accessToken: SourceControlAccessToken
	sourceBranch: string
	targetBranch: string
	title: string
}

export type SourceControlProviderRepositoryPreflight =
	| { type: 'passed' }
	| {
			type: 'failed'
			reason: Extract<
				SourceControlRepositoryPreflightFailureReason,
				| { type: 'provider-authentication-failed' }
				| { type: 'provider-access-denied' }
				| { type: 'provider-repository-not-found' }
				| { type: 'provider-unavailable' }
			>
	  }

export interface SourceControlProvider<Config extends RepositoryConfig> {
	preflightRepository(input: SourceControlProviderPreflightRepositoryInput<Config>): Promise<SourceControlProviderRepositoryPreflight>
	createArtifactBranch(input: SourceControlProviderCreateArtifactBranchInput<Config>): Promise<SourceControlArtifactCreation>
	createReviewSurface(input: SourceControlProviderCreateReviewSurfaceInput<Config>): Promise<SourceControlReviewSurfaceCreation>
}

export type GitHubRepository = Repository & { config: GitHubRepositoryConfig }
