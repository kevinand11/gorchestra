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
import type { CoreRuntime } from '../runtime'
import type { CoreStorage } from '../services'
import type { Result as CoreResult } from '../utils/types'
import type { RepositoryCommandReferenceError } from './utils/errors'
import { validateActiveSecret } from '../utils/secrets'
import { buildCommandHandler } from './utils/handler'
import {
	getRequired,
	normalizeRepositoryConfig,
	updateRecordValue,
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

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

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
			seedProject(options.tx, '01k00000000000000000000030')
			seedSecret(options.tx, '01k00000000000000000000040')
			seedSecret(options.tx, '01k00000000000000000000041')
			options.tx.repositories.records.set('01k00000000000000000000034', {
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
				created: localStamp(),
			})
			const command = createUpdateRepositoryConfigCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					repositoryId: '01k00000000000000000000034',
					config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: '01k00000000000000000000041' },
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000000034',
					projectId: '01k00000000000000000000030',
					config: { provider: 'github', owner: 'Octo', name: 'Renamed', secretId: '01k00000000000000000000041' },
					created: localStamp(),
				},
			})
		})
	})
}
