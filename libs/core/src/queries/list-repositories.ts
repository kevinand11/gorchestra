import { v, type PipeInput, type PipeOutput } from 'valleyed'

import { mapPaginatedQueryEnvelope, paginatedQueryEnvelopePipe, paginatedQueryInputPipe, idPipe } from '../domain/commons'
import { repositoryPipe, type Repository } from '../domain/repository'
import type {
	InvalidCoreServiceOutputError,
	InvalidInputError,
	ProjectSourceTypeMismatchError,
	ResourceNotFoundError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = v.merge(v.object({ projectId: idPipe }), paginatedQueryInputPipe)
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(repositoryPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error =
	| InvalidInputError
	| InvalidCoreServiceOutputError
	| ProjectSourceTypeMismatchError
	| ResourceNotFoundError
	| StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListRepositoriesQuery(options: CoreServices): Operation {
	return buildQueryHandler('listRepositories', inputPipe, (input) =>
		withTransaction<Result, Exclude<Error, InvalidInputError>>(options, async (storage) => {
			const projectResult = await getRequired('project', storage, input.projectId)
			if (!projectResult.ok) return projectResult
			if (projectResult.value.source.type !== 'source-control') {
				return {
					ok: false,
					error: {
						type: 'project-source-type-mismatch',
						projectId: input.projectId,
						expected: 'source-control',
						actual: projectResult.value.source.type,
					},
				}
			}

			const repositories = await listRecordsPaginated('repository', storage, input, {
				where: (filter, fields) => filter.eq(fields.projectId, projectResult.value.id),
			})
			return repositories.ok
				? { ok: true, value: mapPaginatedQueryEnvelope(repositories.value, (repository) => repository) }
				: repositories
		}),
	) as Operation
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

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})

		it('lists Repositories for one Project in id-desc order', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			seedProject(options.tx, '01k00000000000000000000031')
			seedRepositoryFixtures(options)
			const query = createListRepositoriesQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						repository({
							id: '01k00000000000000000100026',
							projectId: '01k00000000000000000000030',
							owner: 'Octo',
							name: 'Beta',
							createdAt: '2026-06-10T00:00:00.000Z',
						}),
						repository({
							id: '01k00000000000000000100025',
							projectId: '01k00000000000000000000030',
							owner: 'Octo',
							name: 'Alpha',
							createdAt: '2026-06-09T00:00:00.000Z',
						}),
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 2, total: 2, count: 2 },
				},
			})
		})

		it('returns storage errors when Repository reads fail', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, '01k00000000000000000000030')
			options.tx.repositories.fail.list = true
			const query = createListRepositoriesQuery(options)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'repository' } },
			})
		})
	})

	function seedRepositoryFixtures(options: ReturnType<typeof createTestCoreServices>): void {
		for (const input of [
			{
				id: '01k00000000000000000100026',
				projectId: '01k00000000000000000000030',
				owner: 'Octo',
				name: 'Beta',
				createdAt: '2026-06-10T00:00:00.000Z',
			},
			{
				id: '01k00000000000000000100025',
				projectId: '01k00000000000000000000030',
				owner: 'Octo',
				name: 'Alpha',
				createdAt: '2026-06-09T00:00:00.000Z',
			},
			{ id: '01k00000000000000000100028', projectId: '01k00000000000000000000031', owner: 'Other', name: 'Repo' },
		]) {
			options.tx.repositories.records.set(input.id, repository(input))
		}
	}

	function repository(input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository {
		return {
			id: input.id,
			projectId: input.projectId,
			config: { provider: 'github', owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
			created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
		}
	}
}
