import { nonEmptyTrimmedStringPipe } from '../domain/commons'
import type { InvalidCoreServiceOutputError, StorageOperationFailedError } from '../errors'
import type { CoreDispatchRequest, CoreServices, CoreStorage } from '../services'
import { validateCoreServiceOutput } from '../validation'
import type { NotificationEmitter } from './notification-emitter'
import type { Result } from './types'

export interface CoreTransactionDispatch {
	request(input: CoreDispatchRequest): Promise<Result<void, InvalidCoreServiceOutputError>>
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
	effectType: 'dispatch-ready' | 'notification-publish'
	run: (() => void) | null
}

export function createCoreTransactions(input: {
	services: Pick<CoreServices, 'dispatcher' | 'logger' | 'storage'>
	notifications: NotificationEmitter
}): CoreTransactions {
	const run: CoreTransactions['run'] = async <TValue, TError>(
		operation: (transaction: CoreTransaction) => Promise<Result<TValue, TError>>,
	) => {
		const effects: PostCommitEffect[] = []
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
								const effect: PostCommitEffect = { effectType: 'dispatch-ready', run: null }
								effects.push(effect)
								return (async () => {
									const marker = await input.services.dispatcher.request(request)
									ensureOpen()
									const accepted = validateCoreServiceOutput(nonEmptyTrimmedStringPipe, marker, 'dispatcher', 'request')
									if (!accepted.ok) return accepted
									effect.run = () => input.services.dispatcher.ready(accepted.value)
									return { ok: true, value: undefined }
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

		it('accepts Dispatch requests inside the transaction and readies their markers after commit', async () => {
			const calls: string[] = []
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: (request) => {
					calls.push(`request:${request.type}`)
					return Promise.resolve('marker-1')
				},
				ready: (marker) => calls.push(`ready:${marker}`),
			}
			const transactions = testCoreTransactions(testCoreStorage(), { emit: () => {} }, dispatcher)

			const result = await transactions.run(async ({ dispatch }) => {
				const requested = await dispatch.request(testDispatchRequest())
				calls.push('transaction-finished')
				return requested.ok ? { ok: true, value: undefined } : requested
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['request:agent-run-model-turn', 'transaction-finished', 'ready:marker-1'])
		})

		it('does not ready an accepted Dispatch marker when the transaction rolls back', async () => {
			const ready = vi.fn()
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => Promise.resolve('marker-1'),
				ready,
			}
			const transactions = testCoreTransactions(testCoreStorage(), { emit: () => {} }, dispatcher)

			const result = await transactions.run<void, InvalidCoreServiceOutputError | { type: 'expected-failure' }>(
				async ({ dispatch }) => {
					const requested = await dispatch.request(testDispatchRequest())
					if (!requested.ok) return requested
					return { ok: false, error: { type: 'expected-failure' } }
				},
			)

			expect(result).toEqual({ ok: false, error: { type: 'expected-failure' } })
			expect(ready).not.toHaveBeenCalled()
		})

		it('returns invalid Dispatcher markers as service-output errors without readiness', async () => {
			const ready = vi.fn()
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => Promise.resolve('   '),
				ready,
			}
			const transactions = testCoreTransactions(testCoreStorage(), { emit: () => {} }, dispatcher)

			const result = await transactions.run(({ dispatch }) => dispatch.request(testDispatchRequest()))

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'dispatcher', operation: 'request' },
			})
			expect(ready).not.toHaveBeenCalled()
		})

		it('orders post-commit effects by capability invocation before asynchronous Dispatch acceptance', async () => {
			const calls: string[] = []
			let acceptDispatch: (marker: string) => void = () => {}
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => new Promise<string>((resolve) => (acceptDispatch = resolve)),
				ready: (marker) => calls.push(`ready:${marker}`),
			}
			const transactions = testCoreTransactions(
				testCoreStorage(),
				{ emit: (data) => calls.push(`notification:${data.type}`) },
				dispatcher,
			)

			const result = await transactions.run(async ({ dispatch, notifications }) => {
				const requested = dispatch.request(testDispatchRequest())
				notifications.emit(testNotificationData())
				acceptDispatch('marker-1')
				const accepted = await requested
				return accepted.ok ? { ok: true, value: undefined } : accepted
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['ready:marker-1', 'notification:assistant-message-draft-updated'])
		})

		it('isolates post-commit failures, logs a safe label, and continues later effects', async () => {
			const calls: string[] = []
			const publisherError = new Error('publisher unavailable with sensitive payload')
			const logger: NonNullable<CoreServices['logger']> = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: (message, context) => {
					calls.push(`log:${message}:${String(context?.effectType)}`)
					throw new Error('logger unavailable')
				},
			}
			const dispatcher: CoreServices['dispatcher'] = {
				preflight: () => Promise.resolve({ ok: true }),
				request: () => Promise.resolve('marker-1'),
				ready: (marker) => calls.push(`ready:${marker}`),
			}
			const transactions = testCoreTransactions(
				testCoreStorage(),
				{
					emit: () => {
						throw publisherError
					},
				},
				dispatcher,
				logger,
			)

			const result = await transactions.run(async ({ dispatch, notifications }) => {
				notifications.emit(testNotificationData())
				const requested = await dispatch.request(testDispatchRequest())
				return requested.ok ? { ok: true, value: undefined } : requested
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(calls).toEqual(['log:Core post-commit effect failed.:notification-publish', 'ready:marker-1'])
			expect(JSON.stringify(calls)).not.toContain(publisherError.message)
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
			expect(() => closedTransaction.dispatch.request(testDispatchRequest())).toThrow('Core transaction context is closed.')
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
		dispatcher: CoreServices['dispatcher'] = {
			preflight: () => Promise.resolve({ ok: true }),
			request: () => Promise.resolve('dispatch-marker'),
			ready: () => {},
		},
		logger?: CoreServices['logger'],
	) {
		return createCoreTransactions({ services: { storage, dispatcher, logger }, notifications })
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

	function testDispatchRequest(): CoreDispatchRequest {
		return {
			type: 'agent-run-model-turn',
			agentRunId: '01k00000000000000000000002',
			coordinationClaims: [],
			reason: { type: 'input-appended', inputEventId: '01k00000000000000000000003' },
		}
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
