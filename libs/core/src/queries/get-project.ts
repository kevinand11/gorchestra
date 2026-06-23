import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import type { CoreServices } from '../services'
import { listedProjectFromProjectAndRepositories, sortByCreatedAtThenId, type ListedProject } from './list-projects'
import { getRequired, listRecords, withTransaction } from '../storage/helpers'
import type { Result as CoreResult } from '../utils/types'
import { buildQueryHandler } from './utils/handler'

const getProjectInputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof getProjectInputPipe>

export type Result = ListedProject
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetProjectQuery(options: CoreServices): Operation {
	return buildQueryHandler('getProject', getProjectInputPipe, (input) =>
		withTransaction(options, async (storage) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const repositories = await listRecords('repository', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
			})
			if (!repositories.ok) return repositories

			return {
				ok: true,
				value: listedProjectFromProjectAndRepositories(project.value, sortByCreatedAtThenId(repositories.value)),
			}
		}),
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreServices } = await import('../utils/test-helpers')
	const { project, repository } = testRecords()

	describe('getProject query', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const query = createGetProjectQuery(options)

			const result = await query({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getProject' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns one Project with nested Repositories in creation order', async () => {
			const options = createTestCoreServices()
			options.tx.projects.records.set('project-1', project({ id: 'project-1', title: 'Delivery Ops' }))
			options.tx.projects.records.set('project-2', project({ id: 'project-2', title: 'Other' }))
			options.tx.repositories.records.set(
				'repository-b',
				repository({
					id: 'repository-b',
					projectId: 'project-1',
					owner: 'Octo',
					name: 'Beta',
					createdAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'repository-a',
				repository({
					id: 'repository-a',
					projectId: 'project-1',
					owner: 'Octo',
					name: 'Alpha',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'repository-other',
				repository({ id: 'repository-other', projectId: 'project-2', owner: 'Other', name: 'Repo' }),
			)
			const query = createGetProjectQuery(options)

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({
				ok: true,
				value: {
					...project({ id: 'project-1', title: 'Delivery Ops' }),
					source: {
						type: 'source-control',
						repositories: [
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
					},
				},
			})
		})

		it('returns not-found when the target Project does not exist', async () => {
			const query = createGetProjectQuery(createTestCoreServices())

			const result = await query({ projectId: 'project-1' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: 'project-1' } })
		})
	})

	function testRecords() {
		return {
			project: (input: { id: string; title: string; createdAt?: string }) => ({
				id: input.id,
				title: input.title,
				source: { type: 'source-control' as const },
				config: null,
				created: { origin: 'imported' as const, at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
			repository: (input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }) => ({
				id: input.id,
				projectId: input.projectId,
				config: { provider: 'github' as const, owner: input.owner, name: input.name, secretId: 'secret-1' },
				created: { origin: 'imported' as const, at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
		}
	}
}
