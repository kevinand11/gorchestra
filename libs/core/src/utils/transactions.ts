import { acceptDispatchRequest, type DispatchAcceptance, type DispatchAcceptanceError } from '../dispatch/accept'
import type { DispatchRequestInput } from '../domain/dispatch-request'
import type { StorageOperationFailedError } from '../errors'
import type { CoreServices, CoreStorage } from '../services'
import type { NotificationEmitter } from './notification-emitter'
import type { CoreRuntimeValues } from './runtime-values'
import type { Result } from './types'

export interface CoreTransactionDispatch {
	request(input: DispatchRequestInput): Promise<Result<DispatchAcceptance, DispatchAcceptanceError>>
}

export interface CoreTransaction {
	storage: CoreStorage
	notifications: NotificationEmitter
	dispatch: CoreTransactionDispatch
}

export interface CoreTransactions {
	run<TValue, TError>(
		operation: (transaction: CoreTransaction) => Promise<Result<TValue, TError>>,
	): Promise<Result<TValue, TError | StorageOperationFailedError>>
}

type PostCommitEffect = {
	effectType: 'dispatch-wake' | 'notification-publish'
	run: (() => void) | null
}

export function createCoreTransactions(input: {
	services: Pick<CoreServices, 'dispatchWake' | 'logger' | 'storage'>
	notifications: NotificationEmitter
	values: CoreRuntimeValues
}): CoreTransactions {
	const run: CoreTransactions['run'] = async <TValue, TError>(
		operation: (transaction: CoreTransaction) => Promise<Result<TValue, TError>>,
	) => {
		const effects: PostCommitEffect[] = []
		let dispatchWakeEffect: PostCommitEffect | null = null
		let open = true
		const ensureOpen = () => {
			if (!open) throw new Error('Core transaction context is closed.')
		}
		try {
			const result = await input.services.storage.session(async () => {
				let operationResult: Result<TValue, TError>
				try {
					operationResult = await operation({
						storage: input.services.storage,
						notifications: {
							emit: (data) => {
								ensureOpen()
								effects.push({ effectType: 'notification-publish', run: () => input.notifications.emit(data) })
							},
						},
						dispatch: {
							request: (request) => {
								ensureOpen()
								if (dispatchWakeEffect === null) {
									dispatchWakeEffect = { effectType: 'dispatch-wake', run: null }
									effects.push(dispatchWakeEffect)
								}
								return (async () => {
									const accepted = await acceptDispatchRequest(
										{ storage: input.services.storage, values: input.values },
										request,
									)
									ensureOpen()
									if (accepted.ok && accepted.value.wakeNeeded && input.services.dispatchWake !== undefined) {
										dispatchWakeEffect.run = () => input.services.dispatchWake?.publish()
									}
									return accepted
								})()
							},
						},
					})
				} finally {
					open = false
				}
				if (!operationResult.ok) throw new TransactionResultRollback(operationResult.error)
				return operationResult
			})
			for (const effect of effects) {
				if (effect.run === null) continue
				try {
					effect.run()
				} catch {
					try {
						input.services.logger?.error('Core post-commit effect failed.', { effectType: effect.effectType })
					} catch {
						// Best-effort logging cannot interrupt later post-commit effects.
					}
				}
			}
			return result
		} catch (error) {
			return error instanceof TransactionResultRollback
				? { ok: false, error: error.resultError as TError }
				: { ok: false, error: { type: 'storage-operation-failed', operation: { type: 'transaction', cause: error } } }
		}
	}

	return { run }
}

class TransactionResultRollback extends Error {
	constructor(readonly resultError: unknown) {
		super('Transaction returned an error Result.')
	}
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const { Repo } = await import('equipped/orm')
	const { InMemoryAdapter } = await import('equipped/orm/adapters/in-memory')
	const { dispatchCoordinationId, dispatchCoordinationSchema } = await import('../domain/dispatch-coordination')
	const { dispatchRequestSchema } = await import('../domain/dispatch-request')
	const { projectSchema } = await import('../domain/project')
	const { createNotificationEmitter } = await import('./notification-emitter')
	const { withExplicitCoreStorageId } = await import('./storage/schema')

	describe('createCoreTransactions', () => {
		it('commits writes when the transaction returns a success Result', async () => {
			const storage = testCoreStorage()
			const transactions = testCoreTransactions(storage)

			const result = await transactions.run(async ({ storage: transactionStorage }) => {
				const created = await createProjectRecord(transactionStorage)
				return { ok: true, value: created.id }
			})

			expect(result).toEqual({ ok: true, value: '01k00000000000000000000030' })
			expect(await findProject(storage)).toEqual(projectRecord())
		})

		it('rolls back writes when the transaction returns an error Result', async () => {
			const storage = testCoreStorage()
			const transactions = testCoreTransactions(storage)

			const result = await transactions.run(async ({ storage: transactionStorage }) => {
				await createProjectRecord(transactionStorage)
				return { ok: false, error: { type: 'expected-failure' as const } }
			})

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(await findProject(storage)).toBeNull()
		})

		it('rolls back writes and wraps thrown errors as storage failures', async () => {
			const storage = testCoreStorage()
			const transactions = testCoreTransactions(storage)
			const thrown = new Error('unexpected failure')

			const result = await transactions.run(async ({ storage: transactionStorage }) => {
				await createProjectRecord(transactionStorage)
				throw thrown
			})

			expect(result).toEqual({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'transaction', cause: thrown } },
			})
			expect(await findProject(storage)).toBeNull()
		})

		it('publishes Notifications after the transaction commits', async () => {
			const calls: string[] = []
			const storage = testCoreStorage()
			const transactions = testCoreTransactions(storage, {
				emit: (data) => calls.push(`notification:${data.type}`),
			})

			const result = await transactions.run(({ notifications }) => {
				notifications.emit(testNotificationData())
				calls.push('transaction-finished')
				return Promise.resolve({ ok: true, value: undefined })
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['transaction-finished', 'notification:assistant-message-draft-updated'])
		})

		it('discards Notifications when the transaction rolls back', async () => {
			const published: string[] = []
			const transactions = testCoreTransactions(testCoreStorage(), {
				emit: (data) => published.push(data.type),
			})

			const result = await transactions.run(({ notifications }) => {
				notifications.emit(testNotificationData())
				return Promise.resolve({ ok: false, error: { type: 'expected-failure' as const } })
			})

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(published).toEqual([])
		})

		it('allocates Notification ids only during post-commit publication', async () => {
			const nextId = vi.fn(() => '01k00000000000000000000001')
			const publish = vi.fn()
			const notifications = createNotificationEmitter({ nextId, now: () => new Date() }, { publish })
			const transactions = testCoreTransactions(testCoreStorage(), notifications)

			await transactions.run(({ notifications: pending }) => {
				pending.emit(testNotificationData())
				expect(nextId).not.toHaveBeenCalled()
				return Promise.resolve({ ok: true, value: undefined })
			})

			expect(nextId).toHaveBeenCalledOnce()
			expect(publish).toHaveBeenCalledOnce()
		})

		it('commits a durable Dispatch Request with its owning transaction', async () => {
			const storage = testCoreStorage()
			await withExplicitCoreStorageId(dispatchCoordinationId, () =>
				storage.on(dispatchCoordinationSchema).one().create({ epoch: 0, revision: 0, bootstrapVersion: 0 }),
			)
			const transactions = testCoreTransactions(storage)

			const result = await transactions.run(async ({ dispatch }) => {
				const requested = await dispatch.request(durableDispatchInput())
				if (!requested.ok) return requested
				await createProjectRecord(storage)
				return { ok: true, value: undefined }
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(await storage.on(dispatchRequestSchema).all().find()).toHaveLength(1)
			expect(await findProject(storage)).toEqual(projectRecord())
		})

		it('publishes exactly one payload-free wake after accepting several requests', async () => {
			const storage = testCoreStorage()
			await seedCoordination(storage)
			const publish = vi.fn()
			const transactions = testCoreTransactions(storage, { emit: () => {} }, { publish, subscribe: () => () => {} })

			const result = await transactions.run(async ({ dispatch }) => {
				const first = await dispatch.request(durableDispatchInput())
				if (!first.ok) return first
				const second = await dispatch.request({
					...durableDispatchInput(),
					reason: { type: 'input-appended', inputEventId: '01k00000000000000000000004' },
				})
				return second.ok ? { ok: true, value: undefined } : second
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(publish).toHaveBeenCalledOnce()
			expect(publish).toHaveBeenCalledWith()
			expect(await storage.on(dispatchRequestSchema).all().find()).toHaveLength(2)
		})

		it('rolls back accepted requests and publishes no wake on returned error', async () => {
			const storage = testCoreStorage()
			await seedCoordination(storage)
			const publish = vi.fn()
			const transactions = testCoreTransactions(storage, { emit: () => {} }, { publish, subscribe: () => () => {} })

			const result = await transactions.run<void, DispatchAcceptanceError | { type: 'expected-failure' }>(async ({ dispatch }) => {
				const requested = await dispatch.request(durableDispatchInput())
				if (!requested.ok) return requested
				return { ok: false, error: { type: 'expected-failure' } }
			})

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(publish).not.toHaveBeenCalled()
			expect(await storage.on(dispatchRequestSchema).all().find()).toEqual([])
		})

		it('orders wake and Notification effects by capability invocation', async () => {
			const storage = testCoreStorage()
			await seedCoordination(storage)
			const calls: string[] = []
			const transactions = testCoreTransactions(
				storage,
				{ emit: (data) => calls.push(`notification:${data.type}`) },
				{ publish: () => calls.push('dispatch-wake'), subscribe: () => () => {} },
			)

			const result = await transactions.run(async ({ dispatch, notifications }) => {
				const requested = dispatch.request(durableDispatchInput())
				notifications.emit(testNotificationData())
				const accepted = await requested
				return accepted.ok ? { ok: true, value: undefined } : accepted
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['dispatch-wake', 'notification:assistant-message-draft-updated'])
		})

		it('isolates wake failures, logs only a safe label, and continues later effects', async () => {
			const storage = testCoreStorage()
			await seedCoordination(storage)
			const calls: string[] = []
			const wakeError = new Error('wake unavailable with sensitive payload')
			const logger: NonNullable<CoreServices['logger']> = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: (message, context) => calls.push(`log:${message}:${String(context?.effectType)}`),
			}
			const transactions = testCoreTransactions(
				storage,
				{ emit: () => calls.push('notification') },
				{
					publish: () => {
						throw wakeError
					},
					subscribe: () => () => {},
				},
				logger,
			)

			const result = await transactions.run(async ({ dispatch, notifications }) => {
				const requested = await dispatch.request(durableDispatchInput())
				if (!requested.ok) return requested
				notifications.emit(testNotificationData())
				return { ok: true, value: undefined }
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['log:Core post-commit effect failed.:dispatch-wake', 'notification'])
			expect(JSON.stringify(calls)).not.toContain(wakeError.message)
		})

		it('rejects transaction capability use after the callback settles', async () => {
			const captured: CoreTransaction[] = []
			const transactions = testCoreTransactions(testCoreStorage())
			await transactions.run((transaction) => {
				captured.push(transaction)
				return Promise.resolve({ ok: true, value: undefined })
			})
			const closedTransaction = captured[0]
			if (closedTransaction === undefined) throw new Error('Expected a captured transaction.')

			expect(() => closedTransaction.notifications.emit(testNotificationData())).toThrow('Core transaction context is closed.')
			expect(() => closedTransaction.dispatch.request(durableDispatchInput())).toThrow('Core transaction context is closed.')
		})

		it('isolates effect queues across concurrent top-level transactions', async () => {
			const calls: string[] = []
			let enterFirst: () => void = () => {}
			const firstEntered = new Promise<void>((resolve) => (enterFirst = resolve))
			let releaseFirst: () => void = () => {}
			const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
			const transactions = testCoreTransactions(testCoreStorage(), {
				emit: (data) => calls.push(data.type === 'tool-call-updated' ? data.toolCallId : data.type),
			})

			const first = transactions.run(async ({ notifications }) => {
				notifications.emit(testNotificationData('first'))
				enterFirst()
				await firstReleased
				return { ok: true, value: 'first' }
			})
			await firstEntered
			const second = await transactions.run(({ notifications }) => {
				notifications.emit(testNotificationData('second'))
				return Promise.resolve({ ok: true, value: 'second' })
			})

			expect(second).toEqual({ ok: true, value: 'second' })
			expect(calls).toEqual(['second'])
			releaseFirst()
			expect(await first).toEqual({ ok: true, value: 'first' })
			expect(calls).toEqual(['second', 'first'])
		})
	})

	function testCoreTransactions(
		storage: CoreStorage,
		notifications: NotificationEmitter = { emit: () => {} },
		dispatchWake?: CoreServices['dispatchWake'],
		logger?: CoreServices['logger'],
	) {
		let sequence = 100
		return createCoreTransactions({
			services: {
				storage,
				...(dispatchWake === undefined ? {} : { dispatchWake }),
				...(logger === undefined ? {} : { logger }),
			},
			notifications,
			values: {
				nextId: () => `01k000000000000000000${(++sequence).toString().padStart(5, '0')}`,
				now: () => new Date('2026-07-13T12:00:00.000Z'),
			},
		})
	}

	function testNotificationData(toolCallId?: string): Parameters<NotificationEmitter['emit']>[0] {
		return toolCallId === undefined
			? {
					type: 'assistant-message-draft-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000003',
					draftId: 'draft-1',
					delta: { type: 'model-output-started' },
				}
			: {
					type: 'tool-call-updated',
					agentRunId: '01k00000000000000000000002',
					turnStartedEventId: '01k00000000000000000000003',
					toolCallId,
					update: { type: 'structured', value: null },
				}
	}

	function durableDispatchInput() {
		return {
			payload: { type: 'agent-run-model-turn' as const, agentRunId: '01k00000000000000000000002' },
			coordinationClaims: [
				{
					scope: [{ type: 'agent-run' as const, id: '01k00000000000000000000002' }],
					mode: { type: 'exclusive' as const },
				},
			],
			deduplicationKey: null,
			reason: { type: 'input-appended' as const, inputEventId: '01k00000000000000000000003' },
		}
	}

	function seedCoordination(storage: CoreStorage) {
		return withExplicitCoreStorageId(dispatchCoordinationId, () =>
			storage.on(dispatchCoordinationSchema).one().create({ epoch: 0, revision: 0, bootstrapVersion: 0 }),
		)
	}

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
			actor: { type: 'local-user' as const, id: 'actor-1' },
			correlationId: 'correlation-1',
		}
	}
}
