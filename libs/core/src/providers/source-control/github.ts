import { Octokit } from '@octokit/rest'

import type {
	SourceControlProvider,
	SourceControlProviderPreflightRepositoryInput,
	SourceControlProviderRepositoryPreflight,
} from './types'
import type { GitHubRepositoryConfig } from '../../domain/repository'

export type GitHubSourceControlProvider = SourceControlProvider<GitHubRepositoryConfig>

export interface GitHubRepositoryClient {
	getRepository(input: { owner: string; name: string }): Promise<void>
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

function createOctokitRepositoryClient(input: { accessToken: string }): GitHubRepositoryClient {
	const octokit = new Octokit({ auth: input.accessToken })

	return {
		async getRepository(repository) {
			await octokit.rest.repos.get({ owner: repository.owner, repo: repository.name })
		},
	}
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
	})

	function gitHubPreflightInput(): SourceControlProviderPreflightRepositoryInput<GitHubRepositoryConfig> {
		return {
			repository: {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			},
			accessToken: { type: 'access-token', plaintext: 'token' },
		}
	}

	function passingClient(): GitHubRepositoryClient {
		return { getRepository: () => Promise.resolve() }
	}

	function failingClient(status: number | null): GitHubRepositoryClientFactory {
		return () => ({
			getRepository: () => Promise.reject(status === null ? new Error('failed') : Object.assign(new Error('failed'), { status })),
		})
	}
}
