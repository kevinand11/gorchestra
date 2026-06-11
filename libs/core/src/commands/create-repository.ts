import { v, type PipeOutput } from 'valleyed'

import type { RepositoryCommandReferenceError } from './errors'
import {
	auditStamp,
	nextId,
	normalizeRepositoryConfig,
	putRecord,
	validateActiveSecret,
	validateSourceControlProject,
	validateUniqueRepositoryTarget,
	withTransaction,
} from './storage-utils'
import { buildCommandHandler } from './utils'
import { idPipe, type AuditStamp, type Id, type OperationContext } from '../domain/commons'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorageTransaction, OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../utils/types'

const createRepositoryInputPipe = v.object({ projectId: idPipe, config: repositoryConfigPipe })
export type Input = PipeOutput<typeof createRepositoryInputPipe>

export type Result = Repository

export type Error =
	| InvalidInputError
	| RepositoryCommandReferenceError
	| DuplicateRepositoryTargetError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export type Operation = (input: Input, context: OperationContext) => Promise<CoreResult<Result, Error>>

export function createCreateRepositoryCommand(options: OpenCoreOptions): Operation {
	return buildCommandHandler('createRepository', createRepositoryInputPipe, (input, context) =>
		handleCreateRepository(options, input, context),
	)
}

async function handleCreateRepository(
	options: OpenCoreOptions,
	input: Input,
	context: OperationContext,
): Promise<CoreResult<Repository, Error>> {
	const stampResult = auditStamp(options, context)
	if (!stampResult.ok) return stampResult

	const idResult = nextId(options, 'repository')
	if (!idResult.ok) return idResult

	return withTransaction(options, (tx) => writeRepository(tx, input, stampResult.value, idResult.value))
}

async function writeRepository(
	tx: CoreStorageTransaction,
	input: Input,
	stamp: AuditStamp,
	repositoryId: Id,
): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> {
	const validation = await validateRepositoryCreate(tx, input)
	if (!validation.ok) return validation

	const repository: Repository = {
		id: repositoryId,
		projectId: input.projectId,
		config: normalizeRepositoryConfig(input.config),
		created: stamp,
	}
	const putResult = await putRecord('repository', tx.repositories, repository.id, repository)
	if (!putResult.ok) return putResult

	return { ok: true, value: repository }
}

async function validateRepositoryCreate(
	tx: CoreStorageTransaction,
	input: Input,
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const projectValidation = await validateSourceControlProject(tx, input.projectId)
	if (!projectValidation.ok) return projectValidation

	const secretValidation = await validateActiveSecret(tx, input.config.secretId)
	if (!secretValidation.ok) return secretValidation

	return validateUniqueRepositoryTarget(tx, input.projectId, input.config, null)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestOpenCoreOptions, localStamp, seedProject, seedSecret } = await import('./test-utils')

	describe('createRepository command', () => {
		it('creates Repositories only for Source Control Projects with active Secret references', async () => {
			const options = createTestOpenCoreOptions()
			seedProject(options.tx, 'project-1')
			seedSecret(options.tx, 'secret-1')
			const command = createCreateRepositoryCommand(options)

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
