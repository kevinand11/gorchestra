import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe, type AuditStamp, type Id } from '../domain/commons'
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
	auditStamp,
	createRecordValue,
	nextId,
	normalizeRepositoryConfig,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from './utils/storage'

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

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateRepositoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createRepository', createRepositoryInputPipe, (input, context) =>
		handleCreateRepository(runtime, input, context),
	)
}

async function handleCreateRepository(runtime: CoreRuntime, input: Input, context: CommandContext): Promise<CoreResult<Repository, Error>> {
	const stampResult = auditStamp(runtime.values, context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId(runtime.values)
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
			seedProject(options.tx, '01k00000000000000000000030')
			seedSecret(options.tx, '01k00000000000000000000040')
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId: '01k00000000000000000000030',
					config: { provider: 'github', owner: ' Octo ', name: ' Repo ', secretId: '01k00000000000000000000040' },
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					projectId: '01k00000000000000000000030',
					config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId: '01k00000000000000000000040' },
					created: localStamp(),
				},
			})
		})
	})
}
