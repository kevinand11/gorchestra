import { inc } from 'equipped/orm'

import { dispatchCoordinationId, dispatchCoordinationSchema } from '../domain/dispatch-coordination'
import type { ActiveDispatchAttempt, DispatchAttemptHistory, DispatchRequest } from '../domain/dispatch-request'
import { dispatchRequestSchema } from '../domain/dispatch-request'
import type {
	DispatchAttemptAbortedError,
	DispatchFenceLostError,
	InvalidCoreServiceOutputError,
	InvariantViolationError,
	StorageOperationFailedError,
} from '../errors'
import type { CoreStorage } from '../services'
import { runInsideDispatchFencedWrite } from './attempt-context'
import type { DispatchHandlerOutcome } from './handler'
import { appendBoundedDispatchAttemptHistory } from './history'
import type { CoreRuntime } from '../utils/runtime'
import { runtimeRecord } from '../utils/runtime-values'
import { updateRecord } from '../utils/storage/helpers'
import type { CoreTransaction } from '../utils/transactions'
import type { Result } from '../utils/types'

export type DispatchAttemptControllerError<E> =
	| E
	| DispatchAttemptAbortedError
	| DispatchFenceLostError
	| StorageOperationFailedError
	| InvalidCoreServiceOutputError
	| InvariantViolationError

export interface DispatchAttemptController {
	runWrite<T, E>(operation: (tx: CoreTransaction) => Promise<Result<T, E>>): Promise<Result<T, DispatchAttemptControllerError<E>>>
	commitOutcome<E>(outcome: DispatchHandlerOutcome<E>): Promise<Result<void, DispatchAttemptControllerError<E>>>
	readonly signal: AbortSignal
	readonly request: DispatchRequest
	readonly attempt: ActiveDispatchAttempt
}

export function createDispatchAttemptController(
	runtime: CoreRuntime,
	request: DispatchRequest,
	attempt: ActiveDispatchAttempt,
	abortController = new AbortController(),
): DispatchAttemptController {
	return {
		request,
		attempt,
		signal: abortController.signal,
		runWrite: <T, E>(operation: (tx: CoreTransaction) => Promise<Result<T, E>>) => {
			if (abortController.signal.aborted) return Promise.resolve(attemptAborted(request.id, attempt.number))
			return runtime.transactions.run<T, DispatchAttemptControllerError<E>>(async (tx) => {
				const owned = await touchDispatchFence(tx.storage, request.id, attempt)
				if (!owned.ok) return owned
				if (abortController.signal.aborted) return attemptAborted(request.id, attempt.number)
				return runInsideDispatchFencedWrite(() => operation(tx))
			})
		},
		commitOutcome: <E>(outcome: DispatchHandlerOutcome<E>) => {
			if (abortController.signal.aborted) return Promise.resolve(attemptAborted(request.id, attempt.number))
			return runtime.transactions.run<void, DispatchAttemptControllerError<E>>(async (tx) => {
				const owned = await touchDispatchFence(tx.storage, request.id, attempt)
				if (!owned.ok) return owned
				if (abortController.signal.aborted) return attemptAborted(request.id, attempt.number)
				const finalized = await runInsideDispatchFencedWrite(() => outcome.finalize(tx))
				if (!finalized.ok) return finalized

				const ended = runtimeRecord(runtime.values)
				if (!ended.ok) return ended
				let history: DispatchAttemptHistory
				let lifecycle: DispatchRequest['lifecycle']
				switch (outcome.type) {
					case 'completed':
						history = {
							number: attempt.number,
							started: attempt.claimed,
							ended: ended.value,
							outcome: { type: 'completed', outcome: outcome.outcome },
						}
						lifecycle = { type: 'completed', completed: ended.value, outcome: outcome.outcome }
						break
					case 'waiting':
						history = {
							number: attempt.number,
							started: attempt.claimed,
							ended: ended.value,
							outcome: { type: 'waiting', prerequisite: outcome.prerequisite },
						}
						lifecycle = { type: 'waiting', since: ended.value, prerequisite: outcome.prerequisite }
						break
					case 'reschedule':
						history = {
							number: attempt.number,
							started: attempt.claimed,
							ended: ended.value,
							outcome: {
								type: 'rescheduled',
								eligibleAt: outcome.eligibleAt,
								category: outcome.category,
								summary: outcome.summary,
							},
						}
						lifecycle = { type: 'pending', eligibleAt: outcome.eligibleAt }
						break
					default:
						throw new Error('Unhandled Dispatch handler outcome.')
				}
				const updated = await updateRecord('dispatch-request', tx.storage, request.id, {
					attempts: appendBoundedDispatchAttemptHistory(request.attempts, history),
					lifecycle,
				})
				if (updated.ok) return { ok: true, value: undefined }
				return updated.error.type === 'not-found' ? fenceLost(request.id, attempt.number) : { ok: false, error: updated.error }
			})
		},
	}
}

export async function touchDispatchFence(
	storage: CoreStorage,
	requestId: string,
	attempt: ActiveDispatchAttempt,
): Promise<Result<void, DispatchFenceLostError | StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	try {
		const coordination = await storage
			.on(dispatchCoordinationSchema)
			.one()
			.id(dispatchCoordinationId)
			.update({ revision: inc<typeof dispatchCoordinationSchema>(dispatchCoordinationSchema.fields.revision, 1) })
		if (coordination === null || coordination.epoch !== attempt.coordinationEpoch) {
			return fenceLost(requestId, attempt.number)
		}
	} catch {
		return storageFailure('dispatch-coordination', dispatchCoordinationId)
	}
	return lockDispatchRequestLease(storage, requestId, attempt)
}

export async function lockDispatchRequestLease(
	storage: CoreStorage,
	requestId: string,
	attempt: ActiveDispatchAttempt,
): Promise<Result<void, DispatchFenceLostError | StorageOperationFailedError | InvalidCoreServiceOutputError>> {
	try {
		const lifecycle = dispatchRequestSchema.fields.lifecycle
		const activeAttempt = lifecycle.nested('attempt', 'object')
		const touched = await storage
			.on(dispatchRequestSchema)
			.one()
			.where((filter) =>
				filter
					.eq(dispatchRequestSchema.fields.id, requestId)
					.eq(lifecycle.nested('type', 'string'), 'leased')
					.eq(activeAttempt.nested('token', 'string'), attempt.token)
					.eq(activeAttempt.nested('coordinationEpoch', 'number'), attempt.coordinationEpoch)
					.eq(activeAttempt.nested('number', 'number'), attempt.number),
			)
			.update({ attemptCount: attempt.number })
		return touched === null ? fenceLost(requestId, attempt.number) : { ok: true, value: undefined }
	} catch {
		return storageFailure('dispatch-request', requestId)
	}
}

function attemptAborted(requestId: string, attemptNumber: number): Result<never, DispatchAttemptAbortedError> {
	return { ok: false, error: { type: 'dispatch-attempt-aborted', requestId, attemptNumber } }
}

function fenceLost(requestId: string, attemptNumber: number): Result<never, DispatchFenceLostError> {
	return { ok: false, error: { type: 'dispatch-fence-lost', requestId, attemptNumber } }
}

function storageFailure(resource: 'dispatch-request' | 'dispatch-coordination', id: string): Result<never, StorageOperationFailedError> {
	return { ok: false, error: { type: 'storage-operation-failed', operation: { type: 'update', resource, id } } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId } = await import('../utils/test-helpers')
	const { createRecord } = await import('../utils/storage/helpers')

	describe('Dispatch attempt fencing', () => {
		it('prevents a stale token from committing any Core write', async () => {
			const options = createTestCoreServices()
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'current-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T12:00:00.000Z' },
				heartbeat: { at: '2026-06-10T12:00:00.000Z' },
				expiresAt: '2026-06-10T12:01:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})
			const controller = createDispatchAttemptController(createTestCoreRuntime(options), request, {
				...attempt,
				token: 'stale-token',
			})

			const result = await controller.runWrite((tx) =>
				createRecord('project', tx.storage, {
					id: testId(30),
					title: 'Must not persist',
					source: { type: 'source-control' },
					config: {
						configured: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' },
						value: {
							work: {
								maxProcessableSliceSlots: 1,
								maxCorrectionRetriesPerFailure: 1,
								executionAgentRunProfileId: testId(6),
								revisionExecutionAgentRunProfileId: null,
							},
						},
					},
					created: { origin: 'imported', at: '2026-06-10T12:00:00.000Z' },
				}),
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'dispatch-fence-lost', requestId: request.id, attemptNumber: 1 },
			})
			expect(options.tx.projects.records).toHaveLength(0)
		})

		it('rejects a lease from a superseded coordination epoch', async () => {
			const options = createTestCoreServices()
			options.tx.dispatchCoordination.records.get('00000000000000000000000000')!.epoch = 1
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T12:00:00.000Z' },
				heartbeat: { at: '2026-06-10T12:00:00.000Z' },
				expiresAt: '2026-06-10T12:01:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})

			const result = await createDispatchAttemptController(createTestCoreRuntime(options), request, attempt).runWrite(() =>
				Promise.resolve({ ok: true, value: undefined }),
			)

			expect(result).toEqual({
				ok: false,
				error: { type: 'dispatch-fence-lost', requestId: request.id, attemptNumber: 1 },
			})
		})

		it('commits handler finalization with the terminal request transition', async () => {
			const options = createTestCoreServices()
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'current-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T12:00:00.000Z' },
				heartbeat: { at: '2026-06-10T12:00:00.000Z' },
				expiresAt: '2026-06-10T12:01:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})
			const controller = createDispatchAttemptController(createTestCoreRuntime(options), request, attempt)

			const result = await controller.commitOutcome({
				type: 'completed',
				outcome: 'processed',
				finalize: () => Promise.resolve({ ok: true, value: undefined }),
			})

			expect(result).toEqual({ ok: true, value: undefined })
			expect(options.tx.dispatchRequests.records.get(request.id)).toMatchObject({
				lifecycle: { type: 'completed', outcome: 'processed' },
				attempts: [{ number: 1, outcome: { type: 'completed', outcome: 'processed' } }],
			})
		})
	})
}
