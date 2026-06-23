import { v, type PipeOutput } from 'valleyed'

import type { Project } from '../domain/project'
import type { Repository } from '../domain/repository'
import type { InvalidCoreServiceOutputError, InvalidInputError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const listProjectsInputPipe = v.object({})
export type Input = PipeOutput<typeof listProjectsInputPipe>

export type SourceControlProjectListSource = {
	type: 'source-control'
	repositories: Repository[]
}

export type ListedProject = Omit<Project, 'source'> & { source: SourceControlProjectListSource }

export type Result = ListedProject[]
export type Error = InvalidInputError | InvalidCoreServiceOutputError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createListProjectsQuery(options: CoreServices): Operation {
	return buildQueryHandler('listProjects', listProjectsInputPipe, () =>
		withTransaction(options, async (storage) => {
			const projects = await listRecords('project', storage)
			if (!projects.ok) return projects

			const repositories = await listRecords('repository', storage)
			if (!repositories.ok) return repositories

			return { ok: true, value: listProjects(projects.value, repositories.value) }
		}),
	)
}

function listProjects(projects: Project[], repositories: Repository[]): ListedProject[] {
	const repositoriesByProjectId = groupRepositoriesByProjectId(sortByCreatedAtThenId(repositories))
	return sortByCreatedAtThenId(projects).map((project) =>
		listedProjectFromProjectAndRepositories(project, repositoriesByProjectId.get(project.id) ?? []),
	)
}

const projectSourceListBuilders = {
	'source-control': (project: Project, repositories: Repository[]): ListedProject => {
		const { source: _source, ...projectFields } = project
		return { ...projectFields, source: { type: 'source-control', repositories } }
	},
} satisfies Record<Project['source']['type'], (project: Project, repositories: Repository[]) => ListedProject>

export function listedProjectFromProjectAndRepositories(project: Project, repositories: Repository[]): ListedProject {
	return projectSourceListBuilders[project.source.type](project, repositories)
}

function groupRepositoriesByProjectId(repositories: Repository[]): Map<string, Repository[]> {
	const grouped = new Map<string, Repository[]>()
	for (const repository of repositories) {
		const projectRepositories = grouped.get(repository.projectId) ?? []
		projectRepositories.push(repository)
		grouped.set(repository.projectId, projectRepositories)
	}
	return grouped
}

export function sortByCreatedAtThenId<T extends { id: string; created: { at: string } }>(records: T[]): T[] {
	return [...records].sort((left, right) => left.created.at.localeCompare(right.created.at) || left.id.localeCompare(right.id))
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

			expect(result).toEqual({ ok: true, value: [] })
		})

		it('lists Projects and nested Source Control Repositories in creation order with id tie-breakers', async () => {
			const options = createTestCoreServices()
			options.tx.projects.records.set(
				'project-b',
				project({ id: 'project-b', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
			)
			options.tx.projects.records.set(
				'project-c',
				project({ id: 'project-c', title: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.projects.records.set(
				'project-a',
				project({ id: 'project-a', title: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z' }),
			)
			options.tx.repositories.records.set(
				'repository-b',
				repository({
					id: 'repository-b',
					projectId: 'project-a',
					owner: 'Octo',
					name: 'Beta',
					createdAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'repository-c',
				repository({
					id: 'repository-c',
					projectId: 'project-a',
					owner: 'Octo',
					name: 'Tie C',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'repository-a',
				repository({
					id: 'repository-a',
					projectId: 'project-a',
					owner: 'Octo',
					name: 'Tie A',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'repository-other',
				repository({ id: 'repository-other', projectId: 'missing-project', owner: 'Other', name: 'Repo' }),
			)
			const query = createListProjectsQuery(options)

			const result = await query({})

			expect(result).toEqual({
				ok: true,
				value: [
					{
						...project({ id: 'project-a', title: 'Tie A', createdAt: '2026-06-09T00:00:00.000Z' }),
						source: {
							type: 'source-control',
							repositories: [
								repository({
									id: 'repository-a',
									projectId: 'project-a',
									owner: 'Octo',
									name: 'Tie A',
									createdAt: '2026-06-09T00:00:00.000Z',
								}),
								repository({
									id: 'repository-c',
									projectId: 'project-a',
									owner: 'Octo',
									name: 'Tie C',
									createdAt: '2026-06-09T00:00:00.000Z',
								}),
								repository({
									id: 'repository-b',
									projectId: 'project-a',
									owner: 'Octo',
									name: 'Beta',
									createdAt: '2026-06-10T00:00:00.000Z',
								}),
							],
						},
					},
					{
						...project({ id: 'project-c', title: 'Tie C', createdAt: '2026-06-09T00:00:00.000Z' }),
						source: { type: 'source-control', repositories: [] },
					},
					{
						...project({ id: 'project-b', title: 'Later', createdAt: '2026-06-10T00:00:00.000Z' }),
						source: { type: 'source-control', repositories: [] },
					},
				],
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
				config: null,
				created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
			repository: (input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }): Repository => ({
				id: input.id,
				projectId: input.projectId,
				config: { provider: 'github', owner: input.owner, name: input.name, secretId: 'secret-1' },
				created: { origin: 'imported', at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
		}
	}
}
