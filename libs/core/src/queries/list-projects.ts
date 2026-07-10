import { type PipeInput, type PipeOutput } from 'valleyed'

import { paginatedQueryEnvelopePipe, paginatedQueryInputPipe } from '../domain/commons'
import { listedProjectPipe, type ListedProject, type Project } from '../domain/project'
export type { ListedProject, SourceControlProjectListSource } from '../domain/project'
import type { Repository } from '../domain/repository'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { buildQueryHandler } from '../utils/query-handler'
import { listRecords, listRecordsPaginated, withTransaction } from '../utils/storage/helpers'
import type { Result as CoreResult, UndefinedToOptional } from '../utils/types'

export const inputPipe = paginatedQueryInputPipe
export type Input = UndefinedToOptional<PipeInput<typeof inputPipe>>

export const resultPipe = paginatedQueryEnvelopePipe(listedProjectPipe)
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListProjectsQuery(options: CoreServices): Operation {
	return buildQueryHandler('listProjects', inputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const projects = await listRecordsPaginated('project', storage, input)
			if (!projects.ok) return projects

			const projectIds = projects.value.items.map((project) => project.id)
			const repositories =
				projectIds.length === 0
					? { ok: true as const, value: [] }
					: await listRecords('repository', storage, {
							where: (filter, fields) => filter.in(fields.projectId, projectIds),
							orderBy: [{ field: 'id', direction: 'desc' }],
						})
			if (!repositories.ok) return repositories

			const repositoriesByProjectId = new Map<string, Repository[]>()
			for (const repository of repositories.value) {
				const projectRepositories = repositoriesByProjectId.get(repository.projectId) ?? []
				projectRepositories.push(repository)
				repositoriesByProjectId.set(repository.projectId, projectRepositories)
			}

			return {
				ok: true,
				value: {
					...projects.value,
					items: projects.value.items.map((project) =>
						listedProjectFromProjectAndRepositories(project, repositoriesByProjectId.get(project.id) ?? []),
					),
				},
			}
		}),
	) as Operation
}

export function listedProjectFromProjectAndRepositories(project: Project, repositories: Repository[]): ListedProject {
	switch (project.source.type) {
		case 'source-control': {
			const { source: _source, ...projectFields } = project
			return { ...projectFields, source: { type: 'source-control', repositories } }
		}
		default:
			throw new Error(`Unexpected Project source: ${String(project.source.type)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('../utils/test-helpers')
	const { project, repository } = testRecords()

	describe('listProjects query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.list = true
			const query = createListProjectsQuery(options)

			const result = await query(null as unknown as Input)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'listProjects' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns an empty Project list for an empty Portfolio', async () => {
			const query = createListProjectsQuery(createTestCoreServices())

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 0, total: 0, count: 0 },
				},
			})
		})

		it('lists Projects and nested Source Control Repositories in id-desc order', async () => {
			const options = createTestCoreServices()
			options.tx.projects.records.set(
				'01k00000000000000000100023',
				project({ id: '01k00000000000000000100023', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
			)
			options.tx.projects.records.set(
				'01k00000000000000000100024',
				project({ id: '01k00000000000000000100024', title: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.projects.records.set(
				'01k00000000000000000100022',
				project({ id: '01k00000000000000000100022', title: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100026',
				repository({
					id: '01k00000000000000000100026',
					projectId: '01k00000000000000000100022',
					owner: 'Octo',
					name: 'Beta',
					createdAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100027',
				repository({
					id: '01k00000000000000000100027',
					projectId: '01k00000000000000000100022',
					owner: 'Octo',
					name: 'Tie C',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100025',
				repository({
					id: '01k00000000000000000100025',
					projectId: '01k00000000000000000100022',
					owner: 'Octo',
					name: 'Tie A',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100028',
				repository({ id: '01k00000000000000000100028', projectId: '01k00000000000000000100029', owner: 'Other', name: 'Repo' }),
			)
			const query = createListProjectsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: {
					items: [
						{
							...project({ id: '01k00000000000000000100024', title: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
							source: { type: 'source-control', repositories: [] },
						},
						{
							...project({ id: '01k00000000000000000100023', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
							source: { type: 'source-control', repositories: [] },
						},
						{
							...project({ id: '01k00000000000000000100022', title: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z' }),
							source: {
								type: 'source-control',
								repositories: [
									repository({
										id: '01k00000000000000000100027',
										projectId: '01k00000000000000000100022',
										owner: 'Octo',
										name: 'Tie C',
										createdAt: '2026-06-09T00:00:00.000Z',
									}),
									repository({
										id: '01k00000000000000000100026',
										projectId: '01k00000000000000000100022',
										owner: 'Octo',
										name: 'Beta',
										createdAt: '2026-06-10T00:00:00.000Z',
									}),
									repository({
										id: '01k00000000000000000100025',
										projectId: '01k00000000000000000100022',
										owner: 'Octo',
										name: 'Tie A',
										createdAt: '2026-06-09T00:00:00.000Z',
									}),
								],
							},
						},
					],
					pages: { current: 1, start: 1, last: 1, previous: null, next: null },
					docs: { limit: 3, total: 3, count: 3 },
				},
			})
		})

		it('returns storage errors when Project or Repository reads fail', async () => {
			const projectReadFailure = createTestCoreServices()
			projectReadFailure.tx.projects.fail.list = true
			await expect(createListProjectsQuery(projectReadFailure)({})).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'project' } },
			})

			const repositoryReadFailure = createTestCoreServices()
			repositoryReadFailure.tx.projects.records.set(
				'01k00000000000000000100022',
				project({ id: '01k00000000000000000100022', title: 'Project' }),
			)
			repositoryReadFailure.tx.repositories.fail.list = true
			await expect(createListProjectsQuery(repositoryReadFailure)({})).resolves.toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'repository' } },
			})
		})
	})

	function testRecords() {
		return {
			project: (input: { id: string; title: string; createdAt?: string }): Project => ({
				id: input.id,
				title: input.title,
				source: { type: 'source-control' },
				config: {
					configured: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
					value: {
						work: {
							maxProcessableSliceSlots: 1,
							maxCorrectionRetriesPerFailure: 1,
							executionAgentRunProfileId: '01k00000000000000000000006',
							revisionExecutionAgentRunProfileId: null,
						},
					},
				},
				created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
			repository: (input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository => ({
				id: input.id,
				projectId: input.projectId,
				config: { provider: 'github', owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
				created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
		}
	}
}
