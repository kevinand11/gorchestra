import { v, type PipeOutput } from 'valleyed'

import { idPipe } from '../domain/commons'
import { listedProjectPipe } from '../domain/project'
import type { InvalidCoreServiceOutputError, InvalidInputError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { listedProjectFromProjectAndRepositories } from './list-projects'
import { buildQueryHandler } from '../utils/query-handler'
import { getRequired, listRecords } from '../utils/storage/helpers'
import type { CoreTransactions } from '../utils/transactions'
import type { Result as CoreResult } from '../utils/types'

export const inputPipe = v.object({ projectId: idPipe })
export type Input = PipeOutput<typeof inputPipe>

export const resultPipe = listedProjectPipe
export type Result = PipeOutput<typeof resultPipe>
export type Error = InvalidInputError | InvalidCoreServiceOutputError | ResourceNotFoundError | StorageOperationFailedError
export type Operation = (input: Input) => Promise<CoreResult<Result, Error>>

export function createGetProjectQuery(transactions: CoreTransactions): Operation {
	return buildQueryHandler('getProject', inputPipe, (input) =>
		transactions.run(async ({ storage }) => {
			const project = await getRequired('project', storage, input.projectId)
			if (!project.ok) return project

			const repositories = await listRecords('repository', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, project.value.id),
				orderBy: [{ field: 'id', direction: 'desc' }],
			})
			if (!repositories.ok) return repositories

			return {
				ok: true,
				value: listedProjectFromProjectAndRepositories(project.value, repositories.value),
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
			const query = createGetProjectQuery(options.transactions)

			const result = await query({ projectId: '' })

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'query', operation: 'getProject' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('returns one Project with nested Repositories in id-desc order', async () => {
			const options = createTestCoreServices()
			options.tx.projects.records.set(
				'01k00000000000000000000030',
				project({ id: '01k00000000000000000000030', title: 'Delivery Ops' }),
			)
			options.tx.projects.records.set('01k00000000000000000000031', project({ id: '01k00000000000000000000031', title: 'Other' }))
			options.tx.repositories.records.set(
				'01k00000000000000000100026',
				repository({
					id: '01k00000000000000000100026',
					projectId: '01k00000000000000000000030',
					owner: 'Octo',
					name: 'Beta',
					createdAt: '2026-06-10T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100025',
				repository({
					id: '01k00000000000000000100025',
					projectId: '01k00000000000000000000030',
					owner: 'Octo',
					name: 'Alpha',
					createdAt: '2026-06-09T00:00:00.000Z',
				}),
			)
			options.tx.repositories.records.set(
				'01k00000000000000000100028',
				repository({ id: '01k00000000000000000100028', projectId: '01k00000000000000000000031', owner: 'Other', name: 'Repo' }),
			)
			const query = createGetProjectQuery(options.transactions)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({
				ok: true,
				value: {
					...project({ id: '01k00000000000000000000030', title: 'Delivery Ops' }),
					source: {
						type: 'source-control',
						repositories: [
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
					},
				},
			})
		})

		it('returns not-found when the target Project does not exist', async () => {
			const query = createGetProjectQuery(createTestCoreServices().transactions)

			const result = await query({ projectId: '01k00000000000000000000030' })

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: '01k00000000000000000000030' } })
		})
	})

	function testRecords() {
		return {
			project: (input: { id: string; title: string; createdAt?: string }) => ({
				id: input.id,
				title: input.title,
				source: { type: 'source-control' as const },
				config: {
					configured: { origin: 'imported' as const, at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
					value: {
						work: {
							maxProcessableSliceSlots: 1,
							maxCorrectionRetriesPerFailure: 1,
							executionAgentRunProfileId: '01k00000000000000000000006',
							revisionExecutionAgentRunProfileId: null,
						},
					},
				},
				created: { origin: 'imported' as const, at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
			repository: (input: { id: string; projectId: string; owner: string; name: string; createdAt?: string }) => ({
				id: input.id,
				projectId: input.projectId,
				config: { provider: 'github' as const, owner: input.owner, name: input.name, secretId: '01k00000000000000000000040' },
				created: { origin: 'imported' as const, at: input.createdAt ?? '2026-06-10T00:00:00.000Z' },
			}),
		}
	}
}
