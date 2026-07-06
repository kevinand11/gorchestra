import { v, type PipeOutput } from 'valleyed'

import { validateSourceControlProject } from '../commands/utils/storage'
import { idPipe } from '../domain/commons'
import { repositoryPipe, type Repository } from '../domain/repository'
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

export const inputPipe = v.object({ projectId: idPipe, repositoryId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = repositoryPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ProjectSourceTypeMismatchError
	| ResourceNotFoundError
	| StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetRepositoryQuery(options: CoreServices): Operation {
	return buildQueryHandler('getRepository', inputPipe, (input) =>
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

			const result = await query({ projectId: '', repositoryId: '01k00000000000000000000034' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getRepository' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns the Repository when it belongs to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			const storedRepository = repository({
				id: '01k00000000000000000000034',
				projectId: '01k00000000000000000000030',
				owner: 'Octo',
				name: 'Repo',
			})
			options.tx.repositories.records.set('01k00000000000000000000034', storedRepository)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', repositoryId: '01k00000000000000000000034' })

			expect(result).toEqual({ ok: true, value: storedRepository })
		})

		it('returns not-found when the Project does not exist', async () => {
			const options = createTestCoreServices()
			options.tx.repositories.records.set(
				'01k00000000000000000000034',
				repository({ id: '01k00000000000000000000034', projectId: '01k00000000000000000000030', owner: 'Octo', name: 'Repo' }),
			)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', repositoryId: '01k00000000000000000000034' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})

		it('returns not-found when the Repository does not belong to the Project', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.repositories.records.set(
				'01k00000000000000000000034',
				repository({ id: '01k00000000000000000000034', projectId: '01k00000000000000000000031', owner: 'Octo', name: 'Repo' }),
			)
			const query = createGetRepositoryQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030', repositoryId: '01k00000000000000000000034' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'repository', id: '01k00000000000000000000034' } })
		})
	})

	function repository(input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
			created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
		}
	}
}
