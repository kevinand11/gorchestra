import type { ActiveDispatchAttempt, DispatchAttemptHistory, DispatchRequest } from '../domain/dispatch-request'
import type { DispatchFenceLostError, InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import { touchDispatchFence } from './fence'
import { appendBoundedDispatchAttemptHistory } from './history'
import type { CoreRuntime } from '../utils/runtime'
import { runtimeRecord } from '../utils/runtime-values'
import { updateRecord } from '../utils/storage/helpers'
import type { Result } from '../utils/types'

export type IntentionalDispatchInterruptionReason = 'processor-shutdown' | 'snapshot-restored'

export type DispatchAttemptMaintenanceError =
	| DispatchFenceLostError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| InvariantViolationError

export interface LostDispatchAttempt {
	requestId: string
	attemptToken: string
}

export function heartbeatDispatchAttempts(
	runtime: CoreRuntime,
	owned: ReadonlyArray<{ request: DispatchRequest; attempt: ActiveDispatchAttempt }>,
	leaseMs: number,
): Promise<Result<LostDispatchAttempt[], DispatchAttemptMaintenanceError>> {
	return runtime.transactions.run<LostDispatchAttempt[], DispatchAttemptMaintenanceError>(async (tx) => {
		const heartbeat = runtimeRecord(runtime.values)
		if (!heartbeat.ok) return heartbeat
		const expiresAt = new Date(Date.parse(heartbeat.value.at) + leaseMs).toISOString()
		const lost: LostDispatchAttempt[] = []
		for (const ownedAttempt of owned) {
			const touched = await touchDispatchFence(tx.storage, ownedAttempt.request.id, ownedAttempt.attempt)
			if (!touched.ok) {
				if (touched.error.type === 'dispatch-fence-lost') {
					lost.push({ requestId: ownedAttempt.request.id, attemptToken: ownedAttempt.attempt.token })
					continue
				}
				return touched
			}
			const updated = await updateRecord('dispatch-request', tx.storage, ownedAttempt.request.id, {
				lifecycle: {
					type: 'leased',
					attempt: { ...ownedAttempt.attempt, heartbeat: heartbeat.value, expiresAt },
				},
			})
			if (!updated.ok) {
				if (updated.error.type === 'not-found') {
					lost.push({ requestId: ownedAttempt.request.id, attemptToken: ownedAttempt.attempt.token })
					continue
				}
				return { ok: false, error: updated.error }
			}
		}
		return { ok: true, value: lost }
	})
}

export function interruptDispatchAttempt(
	runtime: CoreRuntime,
	request: DispatchRequest,
	attempt: ActiveDispatchAttempt,
	reason: IntentionalDispatchInterruptionReason,
): Promise<Result<void, DispatchAttemptMaintenanceError>> {
	return runtime.transactions.run<void, DispatchAttemptMaintenanceError>(async (tx) => {
		const touched = await touchDispatchFence(tx.storage, request.id, attempt)
		if (!touched.ok) return touched
		const ended = runtimeRecord(runtime.values)
		if (!ended.ok) return ended
		const history: DispatchAttemptHistory = {
			number: attempt.number,
			started: attempt.claimed,
			ended: ended.value,
			outcome: { type: 'interrupted', reason },
		}
		const updated = await updateRecord('dispatch-request', tx.storage, request.id, {
			attempts: appendBoundedDispatchAttemptHistory(request.attempts, history),
			lifecycle: { type: 'pending', eligibleAt: ended.value.at },
		})
		if (updated.ok) return { ok: true, value: undefined }
		if (updated.error.type === 'not-found') {
			return { ok: false, error: { type: 'dispatch-fence-lost', requestId: request.id, attemptNumber: attempt.number } }
		}
		return { ok: false, error: updated.error }
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId } = await import('../utils/test-helpers')

	describe('Dispatch attempt maintenance', () => {
		it('records intentional interruption without consuming the lease-expiry budget', async () => {
			const options = createTestCoreServices()
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
				expiredLeaseCount: 0,
				lifecycle: { type: 'leased', attempt },
			})

			const result = await interruptDispatchAttempt(createTestCoreRuntime(options), request, attempt, 'processor-shutdown')

			expect(result).toEqual({ ok: true, value: undefined })
			expect(options.tx.dispatchRequests.records.get(request.id)).toMatchObject({
				expiredLeaseCount: 0,
				lifecycle: { type: 'pending' },
				attempts: [{ outcome: { type: 'interrupted', reason: 'processor-shutdown' } }],
			})
		})

		it('reports ownership loss during heartbeat without renewing a replacement attempt', async () => {
			const options = createTestCoreServices()
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'replacement-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T12:00:00.000Z' },
				heartbeat: { at: '2026-06-10T12:00:00.000Z' },
				expiresAt: '2026-06-10T12:01:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})

			const result = await heartbeatDispatchAttempts(
				createTestCoreRuntime(options),
				[{ request, attempt: { ...attempt, token: 'stale-token' } }],
				60_000,
			)

			expect(result).toEqual({ ok: true, value: [{ requestId: request.id, attemptToken: 'stale-token' }] })
			expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toEqual({ type: 'leased', attempt })
		})
	})
}
