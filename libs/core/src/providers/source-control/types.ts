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

export interface SourceControlProviders {
	preflightRepository(
		input: SourceControlRepositoryPreflightInput,
	): Promise<Result<SourceControlRepositoryPreflight, SourceControlRepositoryPreflightError>>
}

export interface SourceControlAccessToken {
	type: 'access-token'
	plaintext: string
}

export interface SourceControlProviderPreflightRepositoryInput<Config extends RepositoryConfig> {
	repository: Repository & { config: Config }
	accessToken: SourceControlAccessToken
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
}

export type GitHubRepository = Repository & { config: GitHubRepositoryConfig }
