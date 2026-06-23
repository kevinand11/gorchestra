import { v, type PipeOutput } from 'valleyed'

import { idPipe, type OperationContext } from '../domain/commons'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import type { RepositoryCommandReferenceError } from './utils/errors'
import { buildCommandHandler } from './utils/handler'
import {
	getRequired,
	normalizeRepositoryConfig,
	updateRecordValue,
	validateActiveSecret,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from './utils/storage'

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

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createUpdateRepositoryConfigCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('updateRepositoryConfig', updateRepositoryConfigInputPipe, (input) =>
		withTransaction(runtime.services, (storage) => updateRepositoryConfig(storage, input)),
	)
}

async function updateRepositoryConfig(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const repositoryResult = await repositoryForConfigUpdate(storage, input)
	if (!repositoryResult.ok) return repositoryResult

	return updateRecordValue('repository', storage, repositoryResult.value.id, { config: normalizeRepositoryConfig(input.config) })
}

async function repositoryForConfigUpdate(
	storage: CoreStorage,
	input: Input,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const repositoryResult = await getRequired('repository', storage, input.repositoryId)
	if (!repositoryResult.ok) return repositoryResult

	const validation = await validateRepositoryConfigUpdate(storage, repositoryResult.value, input)
	return validation.ok ? { ok: true, value: repositoryResult.value } : validation
}

async function validateRepositoryConfigUpdate(
	storage: CoreStorage,
	repository: Repository,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const projectValidation = await validateSourceControlProject(storage, repository.projectId)
	if (!projectValidation.ok) return projectValidation

	const secretValidation = await validateActiveSecret(storage, input.config.secretId)
	if (!secretValidation.ok) return secretValidation

	return validateUniqueRepositoryTarget(storage, repository.projectId, input.config, repository.id)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSecret } =
		await import('../utils/test-helpers')

	describe('updateRepositoryConfig command', () => {
		it('updates Repository config after validating active Secret references', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedSecret(options.tx, 'secret-1')
			seedSecret(options.tx, 'secret-2')
			options.tx.repositories.records.set('repository-1', {
				id: 'repository-1',
				projectId: 'project-1',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
				created: localStamp(),
			})
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

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
