import { v, type PipeOutput } from 'valleyed'

import type { CommandContext } from './types'
import { idPipe } from '../domain/commons'
import { repositoryConfigPipe, type Repository } from '../domain/repository'
import type {
	DuplicateRepositoryTargetError,
	InvalidCoreServiceOutputError,
	InvalidInputError,
	InvariantViolationError,
	StorageOperationFailedError,
} from '../errors'
import type { RepositoryCommandReferenceError } from '../utils/command-errors'
import { buildCommandHandler } from '../utils/command-handler'
import { auditStamp, createRecordValue, getRequired, listRecords, nextId } from '../utils/command-storage'
import type { CoreRuntime } from '../utils/runtime'
import type { Result as CoreResult } from '../utils/types'

const createRepositoryInputPipe = v.object({ projectId: idPipe, config: repositoryConfigPipe })
export type Input = PipeOutput<typeof createRepositoryInputPipe>

export type Result = Repository

export type Error =
	| InvalidInputError
	| RepositoryCommandReferenceError
	| DuplicateRepositoryTargetError
	| InvariantViolationError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError

export type Operation = (input: Input, context: CommandContext) => Promise<CoreResult<Result, Error>>

export function createCreateRepositoryCommand(runtime: CoreRuntime): Operation {
	return buildCommandHandler('createRepository', createRepositoryInputPipe, async (input, context) => {
		const stampResult = auditStamp(runtime.values, context)
		if (!stampResult.ok) return stampResult

		const idResult = nextId(runtime.values)
		if (!idResult.ok) return idResult

		return runtime.transactions.run<Repository, Exclude<Error, InvalidInputError>>(async ({ storage }) => {
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

			const secretsResult = await listRecords('secret', storage, {
				where: (filter, fields) => filter.eq(fields.id, input.config.secretId),
			})
			if (!secretsResult.ok) return secretsResult

			const secret = secretsResult.value.at(0)
			if (secret === undefined) {
				return { ok: false, error: { type: 'not-found', resource: 'secret', id: input.config.secretId } }
			}
			const latestArchivePeriod = secret.archivePeriods.at(-1)
			if (latestArchivePeriod !== undefined && latestArchivePeriod.unarchived === null) {
				return { ok: false, error: { type: 'resource-archived', resource: 'secret', id: input.config.secretId } }
			}

			const repositoriesResult = await listRecords('repository', storage, {
				where: (filter, fields) => filter.eq(fields.projectId, input.projectId),
			})
			if (!repositoriesResult.ok) return repositoriesResult

			const duplicate = repositoriesResult.value.find(
				(repository) =>
					repository.config.provider === input.config.provider &&
					repository.config.owner.toLocaleLowerCase() === input.config.owner.toLocaleLowerCase() &&
					repository.config.name.toLocaleLowerCase() === input.config.name.toLocaleLowerCase(),
			)
			if (duplicate !== undefined) {
				return {
					ok: false,
					error: {
						type: 'duplicate-repository-target',
						projectId: input.projectId,
						provider: input.config.provider,
						owner: input.config.owner,
						name: input.config.name,
					},
				}
			}

			const repository: Repository = {
				id: idResult.value,
				projectId: input.projectId,
				config: input.config,
				created: stampResult.value,
			}
			return createRecordValue('repository', storage, repository)
		})
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { context, createTestCoreRuntime, createTestCoreServices, localStamp, seedProject, seedSecret } =
		await import('../utils/test-helpers')

	const projectId = '01k00000000000000000000030'
	const secretId = '01k00000000000000000000040'
	const input = {
		projectId,
		config: { provider: 'github' as const, owner: 'Octo', name: 'Repo', secretId },
	}

	describe('createRepository command', () => {
		it('validates input before opening a transaction', async () => {
			const options = createTestCoreServices()
			options.tx.projects.fail.get = true
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command({ ...input, config: { ...input.config, owner: ' ' } }, context)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'command', operation: 'createRepository' },
			})
			expect(options.transactionCalls()).toBe(0)
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('rejects a missing Project without writing a Repository', async () => {
			const options = createTestCoreServices()
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'project', id: projectId } })
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('rejects a Project with the wrong Source Type without writing a Repository', async () => {
			let writeCalled = false
			let transactionCalls = 0
			const options = createTestCoreServices()
			const project = {
				...seedProject(options.tx, projectId),
				source: { type: 'manual' },
			}
			const storage = {
				session: async (run: () => Promise<unknown>) => {
					transactionCalls += 1
					return run()
				},
				on: () => ({
					one: () => ({
						id: () => ({ find: () => Promise.resolve(project) }),
						create: () => {
							writeCalled = true
							return Promise.resolve(project)
						},
					}),
				}),
			} as never
			const command = createCreateRepositoryCommand(createTestCoreRuntime({ ...options, storage }))

			const result = await command(input, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'project-source-type-mismatch',
					projectId,
					expected: 'source-control',
					actual: 'manual',
				},
			})
			expect(transactionCalls).toBe(1)
			expect(writeCalled).toBe(false)
		})

		it('rejects a missing selected Secret without writing a Repository', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, projectId)
			seedSecret(options.tx, '01k00000000000000000000041')
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({ ok: false, error: { type: 'not-found', resource: 'secret', id: secretId } })
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('rejects an archived selected Secret without writing a Repository', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, projectId)
			seedSecret(options.tx, secretId, true)
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'resource-archived', resource: 'secret', id: secretId },
			})
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('rejects a case-insensitive duplicate target without writing a Repository', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, projectId)
			seedSecret(options.tx, secretId)
			options.tx.repositories.records.set('01k00000000000000000000034', {
				id: '01k00000000000000000000034',
				projectId,
				config: { ...input.config, owner: 'octo', name: 'repo' },
				created: localStamp(),
			})
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command({ ...input, config: { ...input.config, owner: ' OcTo ', name: ' REPO ' } }, context)

			expect(result).toEqual({
				ok: false,
				error: {
					type: 'duplicate-repository-target',
					projectId,
					provider: 'github',
					owner: 'OcTo',
					name: 'REPO',
				},
			})
			expect(options.tx.repositories.records.size).toBe(1)
		})

		it('preserves selected Secret list failures without writing a Repository', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, projectId)
			options.tx.secrets.fail.list = true
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(input, context)

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'list', resource: 'secret' } },
			})
			expect(options.tx.repositories.records.size).toBe(0)
		})

		it('creates Repositories only for Source Control Projects with active Secret references', async () => {
			const options = createTestCoreServices()
			seedProject(options.tx, projectId)
			seedSecret(options.tx, secretId)
			const command = createCreateRepositoryCommand(createTestCoreRuntime(options))

			const result = await command(
				{
					projectId,
					config: { provider: 'github', owner: ' Octo ', name: ' Repo ', secretId },
				},
				context,
			)

			expect(result).toEqual({
				ok: true,
				value: {
					id: '01k00000000000000000010001',
					projectId,
					config: { provider: 'github', owner: 'Octo', name: 'Repo', secretId },
					created: localStamp(),
				},
			})
		})
	})
}
