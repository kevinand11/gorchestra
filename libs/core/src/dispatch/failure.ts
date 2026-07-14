import { v } from 'valleyed'

import { appendBoundedDispatchAttemptHistory } from './history'
import type { ActiveDispatchAttempt, DispatchAttemptHistory, DispatchRequest, SafeDispatchFailure } from '../domain/dispatch-request'
import { safeDispatchFailurePipe } from '../domain/dispatch-request'
import type { InvalidCoreServiceOutputError, InvariantViolationError, ResourceNotFoundError, StorageOperationFailedError } from '../errors'
import { appendAgentRunEvent } from '../utils/agent-runs'
import { nextId, runtimeRecord, type CoreRuntimeValues } from '../utils/runtime-values'
import { createRecord, updateRecord } from '../utils/storage/helpers'
import type { CoreTransaction } from '../utils/transactions'
import type { Result } from '../utils/types'

export type DispatchFailureWriteError =
	| InvalidCoreServiceOutputError
	| StorageOperationFailedError
	| ResourceNotFoundError
	| InvariantViolationError

export interface SafeDispatchFailureInput {
	type: 'safe-dispatch-failure'
	failure: SafeDispatchFailure
}

export function safeDispatchFailure(category: string, summary: string): SafeDispatchFailureInput {
	const validated = v.validate(safeDispatchFailurePipe, { category, summary })
	return {
		type: 'safe-dispatch-failure',
		failure: validated.valid ? validated.value : { category: 'dispatch-failure', summary: 'Dispatch processing failed.' },
	}
}

export function toSafeDispatchFailure(failure: unknown): SafeDispatchFailure {
	if (isSafeDispatchFailureInput(failure)) return failure.failure
	if (typeof failure !== 'object' || failure === null || !('type' in failure) || typeof failure.type !== 'string') {
		return { category: 'unexpected-handler-error', summary: 'Dispatch handler failed unexpectedly.' }
	}

	switch (failure.type) {
		case 'storage-operation-failed':
			return { category: failure.type, summary: 'A Core storage operation failed.' }
		case 'invalid-core-service-output':
			return { category: failure.type, summary: 'A Core Service returned invalid output.' }
		case 'sandbox-operation-failed':
			return { category: failure.type, summary: 'A Sandbox operation failed.' }
		case 'sandbox-provider-resolution-failed':
			return { category: failure.type, summary: 'The Sandbox Provider could not be resolved.' }
		case 'external-operation-failed':
			return { category: failure.type, summary: 'An external operation failed.' }
		case 'invariant-violation':
			return { category: failure.type, summary: 'A Core invariant was violated.' }
		default:
			return { category: 'handler-error', summary: 'Dispatch handler returned an error.' }
	}
}

export async function failDispatchRequestWithEvidence(
	context: { tx: CoreTransaction; values: CoreRuntimeValues },
	request: DispatchRequest,
	attempt: ActiveDispatchAttempt,
	failureInput: unknown,
): Promise<Result<void, DispatchFailureWriteError>> {
	const ended = runtimeRecord(context.values)
	if (!ended.ok) return ended
	const failure = toSafeDispatchFailure(failureInput)
	const history: DispatchAttemptHistory = {
		number: attempt.number,
		started: attempt.claimed,
		ended: ended.value,
		outcome: { type: 'failed', failure },
	}
	const updated = await updateRecord('dispatch-request', context.tx.storage, request.id, {
		expiredLeaseCount: request.expiredLeaseCount,
		attempts: appendBoundedDispatchAttemptHistory(request.attempts, history),
		lifecycle: { type: 'failed', failed: ended.value, failure },
	})
	if (!updated.ok) return updated

	switch (request.payload.type) {
		case 'agent-run-model-turn':
		case 'agent-run-preparation':
		case 'agent-run-sandbox-release': {
			const event = await appendAgentRunEvent(
				{ values: context.values, notifications: context.tx.notifications },
				context.tx.storage,
				request.payload.agentRunId,
				{
					type: 'agent-run-dispatch-failed',
					requestId: request.id,
					requestType: request.payload.type,
					attemptNumber: attempt.number,
					category: failure.category,
					summary: failure.summary,
				},
			)
			return event.ok ? { ok: true, value: undefined } : event
		}
		case 'delivery-work-scheduler':
		case 'delivery-work-operation': {
			const actionId = nextId(context.values)
			if (!actionId.ok) return actionId
			const scope =
				request.payload.type === 'delivery-work-operation' && request.payload.operation.scope === 'slice'
					? { type: 'slice' as const, sliceId: request.payload.operation.sliceId }
					: { type: 'delivery' as const }
			const created = await createRecord('action', context.tx.storage, {
				id: actionId.value,
				deliveryId: request.payload.deliveryId,
				performed: ended.value,
				authorized: null,
				result: {
					type: 'record-delivery-work-dispatch-failure',
					scope,
					requestId: request.id,
					requestType: request.payload.type,
					attemptNumber: attempt.number,
					category: failure.category,
					summary: failure.summary,
				},
			})
			return created.ok ? { ok: true, value: undefined } : created
		}
		default:
			throw new Error('Unhandled Dispatch Request payload while recording failure evidence.')
	}
}

function isSafeDispatchFailureInput(value: unknown): value is SafeDispatchFailureInput {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		value.type === 'safe-dispatch-failure' &&
		'failure' in value &&
		v.validate(safeDispatchFailurePipe, value.failure).valid
	)
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { createTestCoreRuntime, createTestCoreServices, seedDispatchRequest, testId, testModelAgentRun } =
		await import('../utils/test-helpers')

	function failureFixture(evidenceWriteFails = false) {
		const options = createTestCoreServices()
		const runtime = createTestCoreRuntime(options)
		const agentRun = testModelAgentRun({ id: testId(2) })
		options.tx.agentRuns.records.set(agentRun.id, agentRun)
		options.tx.agentRunEvents.fail.put = evidenceWriteFails
		const attempt: ActiveDispatchAttempt = {
			number: 1,
			token: 'token',
			coordinationEpoch: 0,
			claimed: { at: '2026-06-10T12:00:00.000Z' },
			heartbeat: { at: '2026-06-10T12:00:00.000Z' },
			expiresAt: '2026-06-10T12:01:00.000Z',
		}
		const request = seedDispatchRequest(options.tx, testId(1), {
			payload: { type: 'agent-run-preparation', agentRunId: agentRun.id },
			reasons: [{ type: 'agent-run-created' }],
			deduplicationKey: { type: 'agent-run-preparation', agentRunId: agentRun.id },
			coordinationClaims: [{ scope: [{ type: 'agent-run', id: agentRun.id }], mode: { type: 'exclusive' } }],
			attemptCount: 1,
			lifecycle: { type: 'leased', attempt },
		})
		return { options, runtime, request, attempt }
	}

	describe('Dispatch failure evidence', () => {
		it('never persists raw unknown error messages, stacks, or causes', () => {
			const raw = new Error('secret provider token')
			;(raw as Error & { cause: unknown }).cause = { authorization: 'secret' }

			const safe = toSafeDispatchFailure(raw)

			expect(safe).toEqual({
				category: 'unexpected-handler-error',
				summary: 'Dispatch handler failed unexpectedly.',
			})
			expect(JSON.stringify(safe)).not.toContain('secret')
		})

		it('commits an Agent Run failure Event with request failure atomically', async () => {
			const { options, runtime, request, attempt } = failureFixture()

			const result = await runtime.transactions.run((tx) =>
				failDispatchRequestWithEvidence({ tx, values: runtime.values }, request, attempt, new Error('raw secret')),
			)

			expect(result).toEqual({ ok: true, value: undefined })
			expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toMatchObject({ type: 'failed' })
			expect([...options.tx.agentRunEvents.records.values()].map((event) => event.body)).toEqual([
				{
					type: 'agent-run-dispatch-failed',
					requestId: request.id,
					requestType: 'agent-run-preparation',
					attemptNumber: 1,
					category: 'unexpected-handler-error',
					summary: 'Dispatch handler failed unexpectedly.',
				},
			])
		})

		it('rolls request failure back when matching evidence cannot be stored', async () => {
			const { options, runtime, request, attempt } = failureFixture(true)

			const result = await runtime.transactions.run((tx) =>
				failDispatchRequestWithEvidence({ tx, values: runtime.values }, request, attempt, new Error('raw secret')),
			)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'storage-operation-failed', operation: { type: 'create', resource: 'agent-run-event' } },
			})
			expect(options.tx.dispatchRequests.records.get(request.id)?.lifecycle).toEqual({ type: 'leased', attempt })
		})
	})
}
