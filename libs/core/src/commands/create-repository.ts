import { v, type PipeOutput } from 'valleyed'

import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
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
import { buildCommandHandler } from '../utils/command'
import type { RepositoryCommandReferenceError } from '../utils/command-errors'
import {
	auditStamp,
	createRecordValue,
	nextId,
	normalizeRepositoryConfig,
	validateActiveSecret,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from '../utils/command-storage'
import type { Result as CoreResult } from '../utils/types'

const createRepositoryInputPipe = v.object({ projectId: idPipe, config: repositoryConfigPipe })
export type Input = PipeOutput<typeof createRepositoryInputPipe>

export type Result = Repository

export type Error =
	| InvalidInputError
	| RepositoryCommandReferenceError
	| DuplicateRepositoryTargetError
	| InvariantViolationError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateRepositoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createRepository', createRepositoryInputPipe, (input, context) =>
		handleCreateRepository(runtime, input, context),
	)
}

async function handleCreateRepository(
	runtime: CoreRuntime,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Repository, Error>> {
	const stampResult = auditStamp(runtime.values, context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId(runtime.values, 'repository')
	if (!idResult.ok) return idResult

	return withTransaction(runtime.services, (storage) => writeRepository(storage, input, stampResult.value, idResult.value))
}

async function writeRepository(
	storage: CoreStorage,
	input: Input,
	stamp: AuditStamp,
	repositoryId: Id,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const validation = await validateRepositoryCreate(storage, input)
	if (!validation.ok) return validation

	const repository: Repository = {
		id: repositoryId,
		projectId: input.projectId,
		config: normalizeRepositoryConfig(input.config),
		created: stamp,
	}
	return createRecordValue('repository', storage, repository)
}

async function validateRepositoryCreate(storage: CoreStorage, input: Input): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const projectValidation = await validateSourceControlProject(storage, input.projectId)
	if (!projectValidation.ok) return projectValidation

	const secretValidation = await validateActiveSecret(storage, input.config.secretId)
	if (!secretValidation.ok) return secretValidation

	return validateUniqueRepositoryTarget(storage, input.projectId, input.config, null)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSecret } =
		await import('../utils/test-helpers')

	describe('createRepository command', () => {
		it('creates Repositories only for Source Control Projects with active Secret references', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedSecret(options.tx, 'secret-1')
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{ projectId: 'project-1', config: { provider: 'github', owner: ' Octo ', name: ' Repo ', secretId: 'secret-1' } },
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: 'repository-1',
					projectId: 'project-1',
					config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: 'secret-1' },
					created: localStamp(),
				},
			})
		})
	})
}
