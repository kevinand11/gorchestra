import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { repositoryConfigPipe, repositoryPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices, CoreStorageTransaction } from '../services'
import { buildCommandHandler } from '../utils/command'
import type { RepositoryCommandReferenceError } from '../utils/command-errors'
import {
	getRequired,
	normalizeRepositoryConfig,
	putRecord,
	validateActiveSecret,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

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

export function createUpdateRepositoryConfigCommand(options: CoreServices): Operation {
	return buildCommandHandler('updateRepositoryConfig', updateRepositoryConfigInputPipe, (input) =>
		withTransaction(options, (tx) => updateRepositoryConfig(tx, input)),
	)
}

async function updateRepositoryConfig(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const repositoryResult = await repositoryForConfigUpdate(tx, input)
	if (!repositoryResult.ok) return repositoryResult

	const repository: Repository = { ...repositoryResult.value, config: normalizeRepositoryConfig(input.config) }
	const putResult = await putRecord('repository', tx.repositories, repository.id, repository)
	if (!putResult.ok) return putResult

	return { ok: true, value: repository }
}

async function repositoryForConfigUpdate(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const repositoryResult = await getRequired('repository', tx.repositories, input.repositoryId, repositoryPipe)
	if (!repositoryResult.ok) return repositoryResult

	const validation = await validateRepositoryConfigUpdate(tx, repositoryResult.value, input)
	return validation.ok ? { ok: true, value: repositoryResult.value } : validation
}

async function validateRepositoryConfigUpdate(
	tx: CoreStorageTransaction,
	repository: Repository,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const projectValidation = await validateSourceControlProject(tx, repository.projectId)
	if (!projectValidation.ok) return projectValidation

	const secretValidation = await validateActiveSecret(tx, input.config.secretId)
	if (!secretValidation.ok) return secretValidation

	return validateUniqueRepositoryTarget(tx, repository.projectId, input.config, repository.id)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject, seedSecret } = await import('../utils/test-helpers')

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
