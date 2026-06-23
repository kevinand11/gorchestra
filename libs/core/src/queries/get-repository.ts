import { v, type PipeOutput } from 'valleyed'

import { validateSourceControlProject } from '../commands/utils/storage'
import { idPipe } from '../domain/commons'
import type { Repository } from '../domain/repository'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices } from '../services'
import { getRequired, notFound, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const getRepositoryInputPipe = v.object({ projectId: idPipe, repositoryId: idPipe })
export type Input = PipeOutput<typeof getRepositoryInputPipe>

export type Result = Repository
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ProjectSourceTypeMismatchError
	| ResourceNotFoundError
	| StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetRepositoryQuery(options: CoreServices): Operation {
	return buildQueryHandler('getRepository', getRepositoryInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await validateSourceControlProject(storage, input.projectId)
			if (!project.ok) return project

			const repository = await getRequired('repository', storage, input.repositoryId)
			if (!repository.ok) return repository

			return repository.value.projectId === project.value.id
				? { ok: true, value: repository.value }
				: notFound('repository', input.repositoryId)
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject } = await import('../utils/test-helpers')

	describe('getRepository query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: '', repositoryId: 'repository-1' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getRepository' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns the Repository when it belongs to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			const storedRepository = repository({ id: 'repository-1', projectId: 'project-1', owner: 'Octo', name: 'Repo' })
			options.tx.repositories.records.set('repository-1', storedRepository)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: 'project-1', repositoryId: 'repository-1' })

			expect(result).toEqual({ ok: true, value: storedRepository })
		})

		it('returns not-found when the Project does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.repositories.records.set(
				'repository-1',
				repository({ id: 'repository-1', projectId: 'project-1', owner: 'Octo', name: 'Repo' }),
			)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: 'project-1', repositoryId: 'repository-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('returns not-found when the Repository does not belong to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.repositories.records.set(
				'repository-1',
				repository({ id: 'repository-1', projectId: 'project-2', owner: 'Octo', name: 'Repo' }),
			)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: 'project-1', repositoryId: 'repository-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'repository', id: 'repository-1' } })
		})
	})

	function repository(input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: 'secret-1' },
			created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
		}
	}
}
