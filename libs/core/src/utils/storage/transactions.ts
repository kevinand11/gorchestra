import type { StorageOperationFailedError } from '../../errors'
import type { CoreServices, CoreStorage } from '../../services'
import type { Result } from '../types'

export async function withTransaction<TValue, TError>(
	options: Pick<CoreServices, 'storage'>,
	run: (storage: CoreStorage) => Promise<Result<TValue, TError>>,
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	try {
		return await options.storage.session(async () => {
			const result = await run(options.storage)
			if (!result.ok) throw new TransactionResultRollback(result.error)
			return result
		})
	} catch (error) {
		return error instanceof TransactionResultRollback
			? { ok: false, error: error.resultError as TError }
			: { ok: false, error: storageFailure({ type: 'transaction', cause: error }) }
	}
}

export async function withTwoPhaseTransaction<TClaim, TOutside, TValue, TError>(
	options: Pick<CoreServices, 'storage'>,
	phases: {
		read: (storage: CoreStorage) => Promise<Result<TClaim, TError>>
		run: (claim: TClaim) => Promise<Result<TOutside, TError>>
		write: (storage: CoreStorage, claim: TClaim, outside: TOutside) => Promise<Result<TValue, TError>>
	},
): Promise<Result<TValue, TError | StorageOperationFailedError>> {
	const claim = await withTransaction(options, phases.read)
	if (!claim.ok) return claim

	const outside = await phases.run(claim.value)
	if (!outside.ok) return outside

	return withTransaction(options, (storage) => phases.write(storage, claim.value, outside.value))
}

class TransactionResultRollback extends Error {
	constructor(readonly resultError: unknown) {
		super('Transaction returned an error Result.')
	}
}

function storageFailure(operation: StorageOperationFailedError['operation']): StorageOperationFailedError {
	return { type: 'storage-operation-failed', operation }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { Repo } = await import('equipped/orm')
	const { InMemoryAdapter } = await import('equipped/orm/adapters/in-memory')
	const { projectSchema } = await import('../../domain/project')
	const { withExplicitCoreStorageId } = await import('./schema')

	describe('withTransaction', () => {
		it('commits writes when the transaction returns a success Result', async () => {
			const storage = testCoreStorage()

			const result = await withTransaction({ storage }, async (transactionStorage) => {
				const created = await createProjectRecord(transactionStorage)
				return { ok: true, value: created.id }
			})

			expect(result).toEqual({ ok: true, value: '01k00000000000000000000030' })
			expect(await findProject(storage)).toEqual(projectRecord())
		})

		it('rolls back writes when the transaction returns an error Result', async () => {
			const storage = testCoreStorage()

			const result = await withTransaction({ storage }, async (transactionStorage) => {
				await createProjectRecord(transactionStorage)
				return { ok: false, error: { type: 'expected-failure' as const } }
			})

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(await findProject(storage)).toBeNull()
		})

		it('rolls back writes and wraps thrown transaction errors as storage failures', async () => {
			const storage = testCoreStorage()
			const thrown = new Error('unexpected failure')

			const result = await withTransaction({ storage }, async (transactionStorage) => {
				await createProjectRecord(transactionStorage)
				throw thrown
			})

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'transaction', cause: thrown } },
			})
			expect(await findProject(storage)).toBeNull()
		})
	})

	function testCoreStorage(): CoreStorage {
		return Repo.from(InMemoryAdapter.create({}))
			.resolve((schema) => ({ table: schema.name }))
			.build() as CoreStorage
	}

	function createProjectRecord(storage: CoreStorage) {
		return withExplicitCoreStorageId('01k00000000000000000000030', () => storage.on(projectSchema).one().create(projectRecord()))
	}

	function findProject(storage: CoreStorage) {
		return storage.on(projectSchema).one().id('01k00000000000000000000030').find()
	}

	function projectRecord() {
		return {
			id: '01k00000000000000000000030',
			title: 'Project',
			source: { type: 'source-control' as const },
			config: {
				configured: localStamp(),
				value: {
					work: {
						maxProcessableSliceSlots: 1,
						maxCorrectionRetriesPerFailure: 1,
						executionAgentRunProfileId: '01k00000000000000000000006',
						revisionExecutionAgentRunProfileId: null,
					},
				},
			},
			created: localStamp(),
		}
	}

	function localStamp() {
		return {
			origin: 'local' as const,
			at: '2026-06-10T12:00:00.000Z',
			actor: { type: 'local-user', id: 'actor-1' },
			correlationId: 'correlation-1',
		}
	}
}
