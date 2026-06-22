import { v, type PipeOutput } from 'valleyed'

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
import { sortByCreatedAtThenId } from './list-projects'
import { buildQueryHandler } from './utils'
import { validateSourceControlProject } from '../utils/command-storage'
import { listRecords, withTransaction } from '../utils/storage'
import type { Result as CoreResult } from '../utils/types'

const listRepositoriesInputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof listRepositoriesInputPipe>

export type Result = Repository[]
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ProjectSourceTypeMismatchError
	| ResourceNotFoundError
	| StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListRepositoriesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listRepositories', listRepositoriesInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await validateSourceControlProject(storage, input.projectId)
			if (!project.ok) return project

			const repositories = await listRecords('repository', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
			})
			return repositories.ok ? { ok: true, value: sortByCreatedAtThenId(repositories.value) } : repositories
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices, seedProject } = await import('../utils/test-helpers')

	describe('listRepositories query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createListRepositoriesQuery(options)

			const result = await query({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listRepositories' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns not-found when the target Project does not exist', async () => {
			const query = createListRepositoriesQuery(createTestCoreServices())

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})

		it('lists Repositories for one Project in creation order', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			seedProject(options.tx, 'project-2')
			seedRepositoryFixtures(options)
			const query = createListRepositoriesQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: true,
				value: [
					repository({
						id: 'repository-a',
						projectId: 'project-1',
						owner: 'Octo',
						name: 'Alpha',
						createdAt: '2026-06-09T00:00:00.000Z',
					}),
					repository({
						id: 'repository-b',
						projectId: 'project-1',
						owner: 'Octo',
						name: 'Beta',
						createdAt: '2026-06-10T00:00:00.000Z',
					}),
				],
			})
		})

		it('returns storage errors when Repository reads fail', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, 'project-1')
			options.tx.repositories.fail.list = true
			const query = createListRepositoriesQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'repository' } },
			})
		})
	})

	function seedRepositoryFixtures(options: ReturnType<typeof createTestCoreServices>): void {
		for (const input of [
			{ id: 'repository-b', projectId: 'project-1', owner: 'Octo', name: 'Beta', createdAt: '2026-06-10T00:00:00.000Z' },
			{ id: 'repository-a', projectId: 'project-1', owner: 'Octo', name: 'Alpha', createdAt: '2026-06-09T00:00:00.000Z' },
			{ id: 'repository-other', projectId: 'project-2', owner: 'Other', name: 'Repo' },
		]) {
			options.tx.repositories.records.set(input.id, repository(input))
		}
	}

	function repository(input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: 'secret-1' },
			created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
		}
	}
}
