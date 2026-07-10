import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	StorageOperationFailedError,
} from '../errors'
import type { RepositoryCommandReferenceError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { getRequired, listRecords, updateRecordValue, withTransaction } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const updateRepositoryConfigInputPipe = v.object({ repositoryId: idPipe, config: repositoryConfigPipe })
export type Input = PipeOutput<typeof updateRepositoryConfigInputPipe>

export type Result = Repository

export type Error =
	| InvalidInputError
	| RepositoryCommandReferenceError
	| DuplicateRepositoryTargetError
	| InvariantViolationError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createUpdateRepositoryConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateRepositoryConfig', updateRepositoryConfigInputPipe, (input) =>
		withTransaction<Repository, Exclude<Error, InvalidInputError>>(runtime.services, async (storage) => {
			const repositoryResult = await getRequired('repository', storage, input.repositoryId)
			if (!repositoryResult.ok) return repositoryResult

			const repository = repositoryResult.value
			const projectResult = await getRequired('project', storage, repository.projectId)
			if (!projectResult.ok) return projectResult

			const projectSourceType = projectResult.value.source.type
			if (projectSourceType !== 'source-control') {
				return {
					ok: false,
					error: {
						type: 'project-source-type-mismatch',
						projectId: repository.projectId,
						expected: 'source-control',
						actual: projectSourceType,
					},
				}
			}

			const selectedSecretsResult = await listRecords('secret', storage, {
				where: (filter, fields) => filter.eq(fields.id, input.config.secretId),
			})
			if (!selectedSecretsResult.ok) return selectedSecretsResult

			const [secret] = selectedSecretsResult.value
			if (secret === undefined) {
				return { ok: false, error: { type: 'not-found', resource: 'secret', id: input.config.secretId } }
			}
			const secretIsArchived = secret.archivePeriods.at(-1)?.unarchived === null
			if (secretIsArchived) {
				return { ok: false, error: { type: 'resource-archived', resource: 'secret', id: input.config.secretId } }
			}

			const repositoriesResult = await listRecords('repository', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, repository.projectId),
			})
			if (!repositoriesResult.ok) return repositoriesResult

			const duplicate = repositoriesResult.value.find(
				(candidate) =>
					candidate.id !== repository.id &&
					candidate.config.provider === input.config.provider &&
					candidate.config.owner.toLocaleLowerCase() === input.config.owner.toLocaleLowerCase() &&
					candidate.config.name.toLocaleLowerCase() === input.config.name.toLocaleLowerCase(),
			)
			if (duplicate !== undefined) {
				return {
					ok: false,
					error: {
						type: 'duplicate-repository-target',
						projectId: repository.projectId,
						provider: input.config.provider,
						owner: input.config.owner,
						name: input.config.name,
					},
				}
			}

			return updateRecordValue('repository', storage, repository.id, { config: input.config })
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSecret } =
		await import('../utils/test-helpers')

	const projectId = '01k00000000000000000000030'
	const otherProjectId = '01k00000000000000000000031'
	const repositoryId = '01k00000000000000000000034'
	const otherRepositoryId = '01k00000000000000000000035'
	const oldSecretId = '01k00000000000000000000040'
	const selectedSecretId = '01k00000000000000000000041'
	const input = {
		repositoryId,
		config: { provider: 'github' as const, owner: 'Octo', name: 'Renamed', secretId: selectedSecretId },
	}

	describe('updateRepositoryConfig command', () => {
		it('returns not-found when the Repository is missing', async () => {
			const options = createTestCoreServices()
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'repository', id: repositoryId } })
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('rejects a missing owning Project before reading the selected Secret', async () => {
			const options = createTestCoreServices()
			seedRepository(options, repositoryId, projectId)
			options.tx.secrets.fail.list = true
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: projectId } })
			expect(options.tx.repositories.records.get(repositoryId)?.config).toEqual(originalConfig())
		})

		it('uses a filtered Secret list read and rejects a missing selected Secret without writing', async () => {
			const options = configuredServices()
			seedSecret(options.tx, oldSecretId)
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: selectedSecretId } })
			expect(options.tx.repositories.records.get(repositoryId)?.config).toEqual(originalConfig())
		})

		it('rejects an archived selected Secret without writing', async () => {
			const options = configuredServices()
			seedSecret(options.tx, selectedSecretId, true)
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'secret', id: selectedSecretId },
			})
			expect(options.tx.repositories.records.get(repositoryId)?.config).toEqual(originalConfig())
		})

		it('rejects a case-insensitive duplicate target in the same Project without writing', async () => {
			const options = configuredServices()
			seedSecret(options.tx, selectedSecretId)
			seedRepository(options, otherRepositoryId, projectId, {
				provider: 'github',
				owner: 'octo',
				name: 'renamed',
				secretId: oldSecretId,
			})
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command({ ...input, config: { ...input.config, owner: ' OcTo ', name: ' RENAMED ' } }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'duplicate-repository-target',
					projectId,
					provider: 'github',
					owner: 'OcTo',
					name: 'RENAMED',
				},
			})
			expect(options.tx.repositories.records.get(repositoryId)?.config).toEqual(originalConfig())
		})

		it('returns Repository update storage failures without changing config', async () => {
			const options = configuredServices()
			seedSecret(options.tx, selectedSecretId)
			options.tx.repositories.fail.put = true
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'update', resource: 'repository', id: repositoryId } },
			})
			expect(options.tx.repositories.records.get(repositoryId)?.config).toEqual(originalConfig())
		})

		it('updates normalized config while excluding itself and other Projects from duplicate detection', async () => {
			const options = configuredServices()
			seedProject(options.tx, otherProjectId)
			seedSecret(options.tx, selectedSecretId)
			seedRepository(options, otherRepositoryId, otherProjectId, {
				provider: 'github',
				owner: 'octo',
				name: 'repo',
				secretId: oldSecretId,
			})
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					repositoryId,
					config: { provider: 'github', owner: ' OcTo ', name: ' Repo ', secretId: selectedSecretId },
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					...repository(repositoryId, projectId),
					config: { provider: 'github', owner: 'OcTo', name: 'Repo', secretId: selectedSecretId },
				},
			})
		})
	})

	function configuredServices() {
		const options = createTestCoreServices()
		seedProject(options.tx, projectId)
		seedRepository(options, repositoryId, projectId)
		return options
	}

	function seedRepository(
		options: ReturnType<typeof createTestCoreServices>,
		id: string,
		owningProjectId: string,
		config = originalConfig(),
	): Repository {
		const stored = { ...repository(id, owningProjectId), config }
		options.tx.repositories.records.set(id, stored)
		return stored
	}

	function repository(id: string, owningProjectId: string): Repository {
		return { id, projectId: owningProjectId, config: originalConfig(), created: localStamp() }
	}

	function originalConfig() {
		return { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId: oldSecretId }
	}
}
