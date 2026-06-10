import { v, type PipeOutput } from 'valleyed'

import type { RepositoryCommandReferenceError } from './errors'
import {
	getRequired,
	normalizeRepositoryConfig,
	putRecord,
	validateActiveSecret,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type OperationContext } from '../domain/commons'
import { repositoryConfigPipe, repositoryPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

const updateRepositoryConfigInputPipe = v.object({ repositoryId: idPipe, config: repositoryConfigPipe })
export type Input = PipeOutput<typeof updateRepositoryConfigInputPipe>

export type Result = Repository

export type Error =
	| InvalidInputError
	| RepositoryCommandReferenceError
	| DuplicateRepositoryTargetError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUpdateRepositoryConfigCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('updateRepositoryConfig', updateRepositoryConfigInputPipe, (input) =>
		// fallow-ignore-next-line complexity
		withTransaction(options, async (tx): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> => {
			const repositoryResult = await getRequired('repository', tx.repositories, input.repositoryId, repositoryPipe)
			if (!repositoryResult.ok) return repositoryResult

			const projectValidation = await validateSourceControlProject(tx, repositoryResult.value.projectId)
			if (!projectValidation.ok) return projectValidation

			const config = input.config
			const secretValidation = await validateActiveSecret(tx, config.secretId)
			if (!secretValidation.ok) return secretValidation

			const duplicateValidation = await validateUniqueRepositoryTarget(
				tx,
				repositoryResult.value.projectId,
				config,
				repositoryResult.value.id,
			)
			if (!duplicateValidation.ok) return duplicateValidation

			const repository: Repository = { ...repositoryResult.value, config: normalizeRepositoryConfig(config) }
			const putResult = await putRecord('repository', tx.repositories, repository.id, repository)
			if (!putResult.ok) return putResult

			return { ok: true, value: repository }
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject, seedSecret } = await import('./test-utils')

	describe('updateRepositoryConfig command', () => {
		it('updates Repository config after validating active Secret references', async () => {
			const options = createTestOpenCoreOptions()
			seedProject(options.tx, 'project-1')
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			options.tx.repositories.records.set('repository-1', {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: localStamp(),
			})
			const command = createUpdateRepositoryConfigCommand(options)

			const result = await command(
				{ repositoryId: 'repository-1', config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: 'secret-2' } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'repository-1',
					projectId: 'project-1',
					config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: 'secret-2' },
					created: localStamp(),
				},
			})
		})
	})
}
