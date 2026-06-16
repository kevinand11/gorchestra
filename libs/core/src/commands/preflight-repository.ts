import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import type { ValidationEvidence } from '../domain/evidence'
import { repositoryPipe, type Repository } from '../domain/repository'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ResourceNotFoundError,
	SecretNotActiveError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import { getRequired, validateActiveSecret, withTransaction } from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const preflightRepositoryInputPipe = v.object({ repositoryId: idPipe })
export type Input = PipeOutput<typeof preflightRepositoryInputPipe>

export type Result = ValidationEvidence

export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

type RepositoryPreflightReadiness = { type: 'passed'; repository: Repository } | { type: 'failed'; summary: string }

type RepositoryPreflightLocalError = InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError

export function createPreflightRepositoryCommand(runtime: CoreRuntime): Operation {
	const options = runtime.services
	return buildCommandHandler('preflightRepository', preflightRepositoryInputPipe, async (input) => {
		const readiness = await readRepositoryPreflightReadiness(options, input)
		if (!readiness.ok) return readiness
		if (readiness.value.type === 'failed') return { ok: true, value: repositoryPreflightEvidence(false, readiness.value.summary) }

		const providerPreflight = await runtime.providers.sourceControl.preflightRepository({ repository: readiness.value.repository })
		if (!providerPreflight.ok) return providerPreflight

		return {
			ok: true,
			value: repositoryPreflightEvidence(providerPreflight.value.type === 'passed', providerPreflight.value.summary),
		}
	})
}

function readRepositoryPreflightReadiness(
	options: CoreServices,
	input: Input,
): Promise<CoreResult<RepositoryPreflightReadiness, RepositoryPreflightLocalError>> {
	return withTransaction(options, (tx) => readRepositoryPreflightReadinessFromStorage(tx, input.repositoryId))
}

async function readRepositoryPreflightReadinessFromStorage(
	tx: CoreStorageTransaction,
	repositoryId: string,
): Promise<CoreResult<RepositoryPreflightReadiness, RepositoryPreflightLocalError>> {
	const repository = await getRequired('repository', tx.repositories, repositoryId, repositoryPipe)
	if (!repository.ok) return repository

	const secret = await validateActiveSecret(tx, repository.value.config.secretId)
	if (!secret.ok) return mapAccessSecretFailure(repository.value, secret.error)

	return { ok: true, value: { type: 'passed', repository: repository.value } }
}

function mapAccessSecretFailure(
	repository: Repository,
	error: ResourceNotFoundError | SecretNotActiveError | StorageOperationFailedError | InvalidCoreServiceOutputError,
): CoreResult<RepositoryPreflightReadiness, RepositoryPreflightLocalError> {
	if (error.type === 'not-found' && error.resource === 'secret') {
		return { ok: true, value: { type: 'failed', summary: accessSecretSummary(repository, 'missing') } }
	}
	if (error.type === 'secret-not-active') {
		return { ok: true, value: { type: 'failed', summary: accessSecretSummary(repository, 'inactive') } }
	}

	return { ok: false, error }
}

function accessSecretSummary(repository: Repository, state: 'missing' | 'inactive'): string {
	switch (repository.config.provider) {
		case 'github':
			return state === 'missing' ? 'GitHub repository access Secret is missing.' : 'GitHub repository access Secret is not active.'
	}
}

function repositoryPreflightEvidence(passed: boolean, summary: string): ValidationEvidence {
	return { type: 'validation', operation: { type: 'repository-preflight' }, passed, summary }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createSourceControlProviders } = await import('../providers/source-control')
	const { context, createTestCoreRuntime, createTestCoreServices, seedSecret, stamp } = await import('../utils/test-helpers')

	describe('preflightRepository command', () => {
		it('validates input before reading storage', async () => {
			const command = createPreflightRepositoryCommand(createTestCoreRuntime())

			const result = await command({} as never, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'preflightRepository' },
			})
		})

		it('returns not-found when the target Repository does not exist', async () => {
			const command = createPreflightRepositoryCommand(createTestCoreRuntime())

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'repository', id: 'repository-1' } })
		})

		it('returns failed evidence when the repository access Secret is missing', async () => {
			const options = repositoryFixture()
			const command = createPreflightRepositoryCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: repositoryPreflightEvidence(false, 'GitHub repository access Secret is missing.'),
			})
		})

		it('returns failed evidence when the repository access Secret is inactive', async () => {
			const options = repositoryFixture()
			seedSecret(options.tx, 'secret-1', true)
			const command = createPreflightRepositoryCommand(createTestCoreRuntime(options, { providers: neverCalledProviders(options) }))

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toEqual({
				ok: true,
				value: repositoryPreflightEvidence(false, 'GitHub repository access Secret is not active.'),
			})
		})

		it('calls Source Control providers outside the storage transaction and returns passing evidence', async () => {
			const options = repositoryFixture()
			seedSecret(options.tx, 'secret-1')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 'token' })
			let providerTransactionCalls: number | null = null
			const providers = {
				sourceControl: createSourceControlProviders(options, {
					github: {
						preflightRepository() {
							providerTransactionCalls = options.transactionCalls()
							return Promise.resolve({ type: 'passed' })
						},
						createArtifactBranch() {
							throw new Error('GitHub provider should not be called.')
						},
						createReviewSurface() {
							throw new Error('GitHub provider should not be called.')
						},
					},
				}),
				modelProviderProtocols: createTestCoreRuntime(options).providers.modelProviderProtocols,
			}
			const command = createPreflightRepositoryCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toEqual({ ok: true, value: repositoryPreflightEvidence(true, 'GitHub repository preflight passed.') })
			expect(providerTransactionCalls).toBe(1)
		})

		it('maps provider failures to failed evidence', async () => {
			const options = repositoryFixture()
			seedSecret(options.tx, 'secret-1')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 'token' })
			const providers = {
				sourceControl: createSourceControlProviders(options, {
					github: {
						preflightRepository: () => Promise.resolve({ type: 'failed', reason: { type: 'provider-repository-not-found' } }),
						createArtifactBranch() {
							throw new Error('GitHub provider should not be called.')
						},
						createReviewSurface() {
							throw new Error('GitHub provider should not be called.')
						},
					},
				}),
				modelProviderProtocols: createTestCoreRuntime(options).providers.modelProviderProtocols,
			}
			const command = createPreflightRepositoryCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toEqual({ ok: true, value: repositoryPreflightEvidence(false, 'GitHub repository was not found.') })
		})

		it('returns invalid Core Service Output from Secret value resolution', async () => {
			const options = repositoryFixture()
			seedSecret(options.tx, 'secret-1')
			options.secrets.resolveSecretValues = () => Promise.resolve({ 'secret-1': 1 } as never)
			const providers = {
				sourceControl: createSourceControlProviders(options, { github: neverCalledGitHubProvider() }),
				modelProviderProtocols: createTestCoreRuntime(options).providers.modelProviderProtocols,
			}
			const command = createPreflightRepositoryCommand(createTestCoreRuntime(options, { providers }))

			const result = await command({ repositoryId: 'repository-1' }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'secrets', operation: 'resolveSecretValues' },
			})
		})
	})

	function repositoryFixture() {
		const options = createTestCoreServices()
		options.tx.repositories.records.set('repository-1', {
			id: 'repository-1',
			projectId: 'project-1',
			config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
			created: stamp,
		})
		return options
	}

	function neverCalledProviders(options: ReturnType<typeof createTestCoreServices>) {
		return {
			sourceControl: createSourceControlProviders(options, { github: neverCalledGitHubProvider() }),
			modelProviderProtocols: createTestCoreRuntime(options).providers.modelProviderProtocols,
		}
	}

	function neverCalledGitHubProvider() {
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
