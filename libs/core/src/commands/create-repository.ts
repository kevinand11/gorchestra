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
import { idPipe, type OperationContext } from '../domain/commons'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	StorageOperationFailedError,
} from '../errors'
import type { OpenCoreOptions } from '../services'
import type { Result as CoreResult } from '../types'

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
	return buildCommandHandler('createRepository', createRepositoryInputPipe, (input, context) => {
		const stampResult = auditStamp(options, context)
		if (!stampResult.ok) return Promise.resolve(stampResult)

		const idResult = nextId(options, 'repository')
		if (!idResult.ok) return Promise.resolve(idResult)

		// fallow-ignore-next-line complexity
		return withTransaction(options, async (tx): Promise<CoreResult<Repository, Exclude<Error, InvalidInputError>>> => {
			const projectValidation = await validateSourceControlProject(tx, input.projectId)
			if (!projectValidation.ok) return projectValidation

			const config = input.config
			const secretValidation = await validateActiveSecret(tx, config.secretId)
			if (!secretValidation.ok) return secretValidation

			const duplicateValidation = await validateUniqueRepositoryTarget(tx, input.projectId, config, null)
			if (!duplicateValidation.ok) return duplicateValidation

			const repository: Repository = {
				id: idResult.value,
				projectId: input.projectId,
				config: normalizeRepositoryConfig(config),
				created: stampResult.value,
			}
			const putResult = await putRecord('repository', tx.repositories, repository.id, repository)
			if (!putResult.ok) return putResult

			return { ok: true, value: repository }
		})
	})
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
