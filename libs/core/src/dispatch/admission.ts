import { inc } from 'equipped/orm'
import { v } from 'valleyed'

import { admitDispatchCandidates } from './claims'
import { failDispatchRequestWithEvidence, safeDispatchFailure, type DispatchFailureWriteError } from './failure'
import { lockDispatchRequestLease } from './fence'
import { appendBoundedDispatchAttemptHistory } from './history'
import type { RuntimeRecord } from '../domain/commons'
import { dispatchCoordinationId, dispatchCoordinationSchema } from '../domain/dispatch-coordination'
import {
	dispatchRequestPipe,
	type ActiveDispatchAttempt,
	type DispatchAttemptHistory,
	type DispatchRequest,
} from '../domain/dispatch-request'
import type { DispatchFenceLostError, InvalidCoreServiceOutputError, InvariantViolationError, StorageOperationFailedError } from '../errors'
import type { CoreRuntime } from '../utils/runtime'
import { nextId, runtimeRecord } from '../utils/runtime-values'
import { listRecords, updateRecord } from '../utils/storage/helpers'
import type { CoreTransaction } from '../utils/transactions'
import type { Result } from '../utils/types'

export interface DispatchAdmissionInput {
	availableSlots: number
	maxConcurrentAttempts: number
	leaseMs: number
	interruptedAttemptLimit: number
	locallyActiveAttemptTokens?: readonly string[]
}

export type DispatchAdmissionError =
	| DispatchFenceLostError
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| InvariantViolationError
	| DispatchFailureWriteError

export function admitDispatchRequests(
	runtime: CoreRuntime,
	input: DispatchAdmissionInput,
): Promise<Result<DispatchRequest[], DispatchAdmissionError>> {
	return runtime.transactions.run<DispatchRequest[], DispatchAdmissionError>((tx) =>
		admitDispatchRequestsInTransaction(runtime, tx, input),
	)
}

async function admitDispatchRequestsInTransaction(
	runtime: CoreRuntime,
	tx: CoreTransaction,
	input: DispatchAdmissionInput,
): Promise<Result<DispatchRequest[], DispatchAdmissionError>> {
	const now = runtimeRecord(runtime.values)
	if (!now.ok) return now
	const coordinationEpoch = await lockDispatchCoordination(tx)
	if (!coordinationEpoch.ok) return coordinationEpoch
	const recovered = await recoverExpiredDispatchLeases(runtime, tx, input, now.value)
	if (!recovered.ok) return recovered

	const requests = await listRecords('dispatch-request', tx.storage)
	if (!requests.ok) return requests
	const validRequests = validatePersistedDispatchRequests(requests.value)
	if (!validRequests.ok) return validRequests
	const nowMs = Date.parse(now.value.at)
	const active = requests.value.filter(
		(request) =>
			request.lifecycle.type === 'leased' &&
			(Date.parse(request.lifecycle.attempt.expiresAt) > nowMs ||
				input.locallyActiveAttemptTokens?.includes(request.lifecycle.attempt.token) === true),
	)
	const pending = requests.value.filter(
		(request) => request.lifecycle.type === 'pending' && Date.parse(request.lifecycle.eligibleAt) <= nowMs,
	)
	const freeSlots = Math.max(0, Math.min(input.availableSlots, input.maxConcurrentAttempts - active.length))
	return leaseDispatchRequests(
		runtime,
		tx,
		admitDispatchCandidates(pending, active, freeSlots),
		coordinationEpoch.value,
		now.value,
		input.leaseMs,
	)
}

async function lockDispatchCoordination(tx: CoreTransaction): Promise<Result<number, DispatchAdmissionError>> {
	try {
		const coordination = await tx.storage
			.on(dispatchCoordinationSchema)
			.one()
			.id(dispatchCoordinationId)
			.update({ revision: inc<typeof dispatchCoordinationSchema>(dispatchCoordinationSchema.fields.revision, 1) })
		return coordination === null ? invariant('Dispatch Coordination singleton is missing.') : { ok: true, value: coordination.epoch }
	} catch {
		return storageUpdateFailure('dispatch-coordination', dispatchCoordinationId)
	}
}

async function recoverExpiredDispatchLeases(
	runtime: CoreRuntime,
	tx: CoreTransaction,
	input: DispatchAdmissionInput,
	now: RuntimeRecord,
): Promise<Result<void, DispatchAdmissionError>> {
	const requests = await listRecords('dispatch-request', tx.storage)
	if (!requests.ok) return requests
	const validRequests = validatePersistedDispatchRequests(requests.value)
	if (!validRequests.ok) return validRequests
	for (const request of requests.value) {
		if (request.lifecycle.type !== 'leased' || Date.parse(request.lifecycle.attempt.expiresAt) > Date.parse(now.at)) continue
		if (input.locallyActiveAttemptTokens?.includes(request.lifecycle.attempt.token) === true) continue
		const recovered = await recoverExpiredDispatchLease(runtime, tx, input, request, request.lifecycle.attempt, now)
		if (!recovered.ok) return recovered
	}
	return { ok: true, value: undefined }
}

async function recoverExpiredDispatchLease(
	runtime: CoreRuntime,
	tx: CoreTransaction,
	input: DispatchAdmissionInput,
	request: DispatchRequest,
	attempt: ActiveDispatchAttempt,
	now: RuntimeRecord,
): Promise<Result<void, DispatchAdmissionError>> {
	const locked = await lockDispatchRequestLease(tx.storage, request.id, attempt)
	if (!locked.ok) return locked.error.type === 'dispatch-fence-lost' ? { ok: true, value: undefined } : locked
	const expiredLeaseCount = request.expiredLeaseCount + 1
	if (expiredLeaseCount <= input.interruptedAttemptLimit) {
		return requeueExpiredDispatchRequest(tx, request, attempt, expiredLeaseCount, now)
	}
	return failDispatchRequestWithEvidence(
		{ tx, values: runtime.values },
		{ ...request, expiredLeaseCount },
		attempt,
		safeDispatchFailure('dispatch-interruption-limit-exceeded', 'Dispatch processing exceeded the interrupted-attempt recovery limit.'),
	)
}

async function requeueExpiredDispatchRequest(
	tx: CoreTransaction,
	request: DispatchRequest,
	attempt: ActiveDispatchAttempt,
	expiredLeaseCount: number,
	now: RuntimeRecord,
): Promise<Result<void, DispatchAdmissionError>> {
	const history: DispatchAttemptHistory = {
		number: attempt.number,
		started: attempt.claimed,
		ended: now,
		outcome: { type: 'interrupted', reason: 'lease-expired' },
	}
	const recovered = await updateRecord('dispatch-request', tx.storage, request.id, {
		expiredLeaseCount,
		attempts: appendBoundedDispatchAttemptHistory(request.attempts, history),
		lifecycle: { type: 'pending', eligibleAt: now.at },
	})
	if (recovered.ok) return { ok: true, value: undefined }
	return recovered.error.type === 'not-found'
		? invariant(`Dispatch Request ${request.id} disappeared during admission.`)
		: { ok: false, error: recovered.error }
}

async function leaseDispatchRequests(
	runtime: CoreRuntime,
	tx: CoreTransaction,
	requests: DispatchRequest[],
	coordinationEpoch: number,
	now: RuntimeRecord,
	leaseMs: number,
): Promise<Result<DispatchRequest[], DispatchAdmissionError>> {
	const admitted: DispatchRequest[] = []
	for (const request of requests) {
		const token = nextId(runtime.values)
		if (!token.ok) return token
		const attempt: ActiveDispatchAttempt = {
			number: request.attemptCount + 1,
			token: token.value,
			coordinationEpoch,
			claimed: now,
			heartbeat: now,
			expiresAt: new Date(Date.parse(now.at) + leaseMs).toISOString(),
		}
		const updated = await updateRecord('dispatch-request', tx.storage, request.id, {
			attemptCount: attempt.number,
			lifecycle: { type: 'leased', attempt },
		})
		if (!updated.ok) {
			return updated.error.type === 'not-found'
				? invariant(`Dispatch Request ${request.id} disappeared during admission.`)
				: { ok: false, error: updated.error }
		}
		admitted.push(updated.value)
	}
	return { ok: true, value: admitted }
}

function validatePersistedDispatchRequests(requests: DispatchRequest[]): Result<void, InvariantViolationError> {
	return requests.every((request) => v.validate(dispatchRequestPipe, request).valid)
		? { ok: true, value: undefined }
		: invariant('Persisted Dispatch Request state is incompatible.')
}

function storageUpdateFailure(resource: 'dispatch-coordination', id: string): Result<never, StorageOperationFailedError> {
	return { ok: false, error: { type: 'storage-operation-failed', operation: { type: 'update', resource, id } } }
}

function invariant(message: string): Result<never, InvariantViolationError> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId, testModelAgentRun } =
		await import('../utils/test-helpers')
	const { deliverySliceOperationClaims, exclusiveAgentRunClaim, exclusiveDeliveryClaim } = await import('./claims')

	const admissionInput: DispatchAdmissionInput = {
		availableSlots: 4,
		maxConcurrentAttempts: 4,
		leaseMs: 60_000,
		interruptedAttemptLimit: 5,
	}

	function seedSliceOperationRequest(options: ReturnType<typeof createTestCoreServices>, deliveryId: string) {
		return seedDispatchRequest(options.tx, testId(2), {
			payload: {
				type: 'delivery-work-operation',
				deliveryId,
				operationId: testId(20),
				operation: { scope: 'slice', sliceId: testId(21), state: 'executable', detail: null },
			},
			reasons: [{ type: 'delivery-work-operation-queued', operationId: testId(20) }],
			deduplicationKey: null,
			coordinationClaims: deliverySliceOperationClaims(deliveryId, testId(21), 2),
		})
	}

	describe('Dispatch admission', () => {
		it('leases one request once and atomically advances coordination', async () => {
			const options = createTestCoreServices()
			const request = seedDispatchRequest(options.tx, testId(1))
			const runtime = createTestCoreRuntime(options)

			const result = await admitDispatchRequests(runtime, admissionInput)

			expect(result).toMatchObject({
				ok: true,
				value: [{ id: request.id, attemptCount: 1, lifecycle: { type: 'leased', attempt: { number: 1 } } }],
			})
			expect(options.tx.dispatchCoordination.records.get('00000000000000000000000000')?.revision).toBe(1)
		})

		it('never leases conflicting parent and descendant requests together', async () => {
			const options = createTestCoreServices()
			const deliveryId = testId(8)
			seedDispatchRequest(options.tx, testId(1), {
				coordinationClaims: [exclusiveDeliveryClaim(deliveryId)],
			})
			seedSliceOperationRequest(options, deliveryId)

			const result = await admitDispatchRequests(createTestCoreRuntime(options), admissionInput)

			expect(result.ok ? result.value.map((request) => request.id) : []).toEqual([testId(1)])
		})

		it('keeps expired locally active leases in the claim set', async () => {
			const options = createTestCoreServices()
			const deliveryId = testId(8)
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'locally-active-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T11:58:00.000Z' },
				heartbeat: { at: '2026-06-10T11:58:00.000Z' },
				expiresAt: '2026-06-10T11:59:00.000Z',
			}
			const activeRequest = seedDispatchRequest(options.tx, testId(1), {
				coordinationClaims: [exclusiveDeliveryClaim(deliveryId)],
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})
			seedSliceOperationRequest(options, deliveryId)

			const result = await admitDispatchRequests(createTestCoreRuntime(options), {
				...admissionInput,
				locallyActiveAttemptTokens: [attempt.token],
			})

			expect(result).toEqual({ ok: true, value: [] })
			expect(options.tx.dispatchRequests.records.get(activeRequest.id)?.lifecycle).toEqual({ type: 'leased', attempt })
		})

		it('reclaims an expired lease with the next durable attempt number', async () => {
			const options = createTestCoreServices()
			const attempt: ActiveDispatchAttempt = {
				number: 1,
				token: 'old-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T11:58:00.000Z' },
				heartbeat: { at: '2026-06-10T11:58:00.000Z' },
				expiresAt: '2026-06-10T11:59:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				attemptCount: 1,
				lifecycle: { type: 'leased', attempt },
			})

			const result = await admitDispatchRequests(createTestCoreRuntime(options), admissionInput)

			expect(result).toMatchObject({
				ok: true,
				value: [{ id: request.id, attemptCount: 2, expiredLeaseCount: 1, lifecycle: { type: 'leased' } }],
			})
			expect(options.tx.dispatchRequests.records.get(request.id)?.attempts).toMatchObject([
				{ number: 1, outcome: { type: 'interrupted', reason: 'lease-expired' } },
			])
		})

		it('fails expiry six with safe evidence instead of reclaiming beyond the default budget', async () => {
			const options = createTestCoreServices()
			const agentRun = testModelAgentRun({ id: testId(2) })
			options.tx.agentRuns.records.set(agentRun.id, agentRun)
			const attempt: ActiveDispatchAttempt = {
				number: 6,
				token: 'old-token',
				coordinationEpoch: 0,
				claimed: { at: '2026-06-10T11:58:00.000Z' },
				heartbeat: { at: '2026-06-10T11:58:00.000Z' },
				expiresAt: '2026-06-10T11:59:00.000Z',
			}
			const request = seedDispatchRequest(options.tx, testId(1), {
				payload: { type: 'agent-run-preparation', agentRunId: agentRun.id },
				reasons: [{ type: 'agent-run-created' }],
				deduplicationKey: { type: 'agent-run-preparation', agentRunId: agentRun.id },
				coordinationClaims: [exclusiveAgentRunClaim(agentRun.id)],
				attemptCount: 6,
				expiredLeaseCount: 5,
				lifecycle: { type: 'leased', attempt },
			})

			const result = await admitDispatchRequests(createTestCoreRuntime(options), admissionInput)

			expect(result).toEqual({ ok: true, value: [] })
			expect(options.tx.dispatchRequests.records.get(request.id)).toMatchObject({
				expiredLeaseCount: 6,
				lifecycle: {
					type: 'failed',
					failure: { category: 'dispatch-interruption-limit-exceeded' },
				},
			})
			expect([...options.tx.agentRunEvents.records.values()].map((event) => event.body.type)).toEqual(['agent-run-dispatch-failed'])
		})
	})
}
