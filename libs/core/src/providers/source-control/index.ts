import { v } from 'valleyed'

import { createGitHubSourceControlProvider, type GitHubSourceControlProvider } from './github'
import type {
	GitHubRepository,
	SourceControlAccessToken,
	SourceControlProviders,
	SourceControlRepositoryPreflight,
	SourceControlRepositoryPreflightError,
	SourceControlRepositoryPreflightFailureReason,
} from './types'
import type { Id } from '../../domain/commons'
import type { Repository } from '../../domain/repository'
import { resolvedSecretValuesPipe, type CoreServices, type ResolvedSecretValue } from '../../services'
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
	}
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

	return shapeValidation.value.length === 0
		? { ok: true, value: unresolvedAccessSecretPreflight(secretId) }
		: exactAccessToken(secretId, shapeValidation.value)
}

function exactAccessToken(
	secretId: Id,
	values: ResolvedSecretValue[],
): Result<SourceControlAccessToken, SourceControlRepositoryPreflightError> {
	const exactValidation = validateCoreServiceOutput(resolvedSecretValuesForPipe(secretId), values, 'secrets', 'resolveSecretValues')
	if (!exactValidation.ok) return exactValidation

	return { ok: true, value: { type: 'access-token', plaintext: exactValidation.value[0]!.plaintext } }
}

function resolvedSecretValuesForPipe(secretId: Id) {
	return resolvedSecretValuesPipe.pipe(
		v.custom<ResolvedSecretValue[]>(
			(values) => values.length === 1 && values[0]?.secretId === secretId,
			'Expected exactly one resolved value for the requested Secret.',
		),
	)
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

function unresolvedAccessSecretPreflight(secretId: Id): SourceControlRepositoryPreflight {
	return gitHubRepositoryPreflight({ type: 'failed', reason: { type: 'repository-access-secret-unresolved', secretId } })
}

function isAccessToken(value: SourceControlAccessToken | SourceControlRepositoryPreflight): value is SourceControlAccessToken {
	return value.type === 'access-token'
}

export type { GitHubSourceControlProvider } from './github'

export type {
	SourceControlAccessToken,
	SourceControlProvider,
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
			const services = coreServices(() => Promise.resolve([{ secretId: 'secret-1', plaintext: 'token' }]))
			let observedToken: string | null = null
			const sourceControl = createSourceControlProviders(services, {
				github: {
					preflightRepository(input) {
						observedToken = input.accessToken.plaintext
						return Promise.resolve({ type: 'passed' })
					},
				},
			})

			const result = await sourceControl.preflightRepository({ repository: gitHubRepository() })

			expect(result).toEqual({ ok: true, value: { type: 'passed', summary: 'GitHub repository preflight passed.' } })
			expect(observedToken).toBe('token')
		})

		it('returns failed preflight when the Secret service resolves no value', async () => {
			const services = coreServices(() => Promise.resolve([]))
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

		it('rejects extra resolved Secret values as invalid Core Service Output', async () => {
			const services = coreServices(() =>
				Promise.resolve([
					{ secretId: 'secret-1', plaintext: 'token' },
					{ secretId: 'secret-2', plaintext: 'other-token' },
				]),
			)
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
		}
	}
}
