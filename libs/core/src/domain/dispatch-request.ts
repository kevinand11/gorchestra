import { v, type Pipe, type PipeOutput } from 'valleyed'

import {
	freeFormStringPipe,
	idPipe,
	isoDateTimePipe,
	nonEmptyTrimmedStringPipe,
	nonNegativeIntegerPipe,
	positiveIntegerPipe,
	runtimeRecordPipe,
	type Id,
} from './commons'
import { deliveryWorkOperationPipe } from './delivery-work-operation'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export const maxDispatchReasons = 64
export const maxDispatchAttemptHistory = 64
export const maxSafeDispatchSummaryChars = 1_000

export const dispatchRequestTypePipe = v.in([
	'agent-run-model-turn',
	'agent-run-preparation',
	'agent-run-sandbox-release',
	'delivery-work-scheduler',
	'delivery-work-operation',
])
export type DispatchRequestType = PipeOutput<typeof dispatchRequestTypePipe>

export const dispatchRequestPayloadPipe = v.discriminate((value) => value.type, {
	'agent-run-model-turn': v.object({ type: v.eq('agent-run-model-turn'), agentRunId: idPipe }),
	'agent-run-preparation': v.object({ type: v.eq('agent-run-preparation'), agentRunId: idPipe }),
	'agent-run-sandbox-release': v.object({ type: v.eq('agent-run-sandbox-release'), agentRunId: idPipe }),
	'delivery-work-scheduler': v.object({ type: v.eq('delivery-work-scheduler'), deliveryId: idPipe }),
	'delivery-work-operation': v.object({
		type: v.eq('delivery-work-operation'),
		deliveryId: idPipe,
		operation: deliveryWorkOperationPipe,
		operationId: idPipe,
	}),
})
export type DispatchRequestPayload = PipeOutput<typeof dispatchRequestPayloadPipe>

export const dispatchReasonPipe = v.discriminate((value) => value.type, {
	'input-appended': v.object({ type: v.eq('input-appended'), inputEventId: idPipe }),
	'agent-run-created': v.object({ type: v.eq('agent-run-created') }),
	'runtime-requirement-override-added': v.object({ type: v.eq('runtime-requirement-override-added'), eventId: idPipe }),
	'agent-run-completed': v.object({ type: v.eq('agent-run-completed') }),
	'delivery-work-requested': v.object({ type: v.eq('delivery-work-requested') }),
	'delivery-work-operation-queued': v.object({ type: v.eq('delivery-work-operation-queued'), operationId: idPipe }),
})
export type DispatchReason = PipeOutput<typeof dispatchReasonPipe>

export type DispatchCoordinationScopeSegment =
	| { type: 'agent-run'; id: Id }
	| { type: 'delivery'; id: Id }
	| { type: 'scheduler' }
	| { type: 'slice-pool' }
	| { type: 'slice'; id: Id }

const dispatchCoordinationScopeSegmentPipe = v.discriminate((value) => value.type, {
	'agent-run': v.object({ type: v.eq('agent-run'), id: idPipe }),
	delivery: v.object({ type: v.eq('delivery'), id: idPipe }),
	scheduler: v.object({ type: v.eq('scheduler') }),
	'slice-pool': v.object({ type: v.eq('slice-pool') }),
	slice: v.object({ type: v.eq('slice'), id: idPipe }),
}) as Pipe<DispatchCoordinationScopeSegment, DispatchCoordinationScopeSegment>

type DispatchCoordinationMode = { type: 'exclusive' } | { type: 'shared-capacity'; capacity: number }

const dispatchCoordinationModePipe = v.discriminate((value) => value.type, {
	exclusive: v.object({ type: v.eq('exclusive') }),
	'shared-capacity': v.object({ type: v.eq('shared-capacity'), capacity: positiveIntegerPipe }),
}) as Pipe<DispatchCoordinationMode, DispatchCoordinationMode>

export type DispatchCoordinationClaim = {
	scope: DispatchCoordinationScopeSegment[]
	mode: DispatchCoordinationMode
}

export const dispatchCoordinationClaimPipe = v.object({
	scope: v.array(dispatchCoordinationScopeSegmentPipe).pipe(v.min(1)),
	mode: dispatchCoordinationModePipe,
}) as Pipe<DispatchCoordinationClaim, DispatchCoordinationClaim>

export const dispatchDeduplicationKeyPipe = v.discriminate((value) => value.type, {
	'agent-run-preparation': v.object({ type: v.eq('agent-run-preparation'), agentRunId: idPipe }),
	'agent-run-sandbox-release': v.object({ type: v.eq('agent-run-sandbox-release'), agentRunId: idPipe }),
	'delivery-work-scheduler': v.object({ type: v.eq('delivery-work-scheduler'), deliveryId: idPipe }),
})
export type DispatchDeduplicationKey = PipeOutput<typeof dispatchDeduplicationKeyPipe>

export const dispatchWaitingPrerequisitePipe = v.discriminate((value) => value.type, {
	'agent-run-preparation': v.object({ type: v.eq('agent-run-preparation'), agentRunId: idPipe }),
})
export type DispatchWaitingPrerequisite = PipeOutput<typeof dispatchWaitingPrerequisitePipe>

export const safeDispatchCategoryPipe = nonEmptyTrimmedStringPipe.pipe(v.max(100))
export const safeDispatchSummaryPipe = freeFormStringPipe.pipe(v.min(1), v.max(maxSafeDispatchSummaryChars))
const safeDispatchFailureShapePipe = v.object({
	category: safeDispatchCategoryPipe,
	summary: safeDispatchSummaryPipe,
})
export const safeDispatchFailurePipe = v.any<{ category: string; summary: string }>().pipe(
	v.custom(
		(value) =>
			typeof value === 'object' && value !== null && Object.keys(value).every((key) => key === 'category' || key === 'summary'),
		'Unexpected safe Dispatch failure field.',
	),
	safeDispatchFailureShapePipe,
)
export type SafeDispatchFailure = PipeOutput<typeof safeDispatchFailurePipe>

export const activeDispatchAttemptPipe = v.object({
	number: positiveIntegerPipe,
	token: nonEmptyTrimmedStringPipe,
	coordinationEpoch: nonNegativeIntegerPipe,
	claimed: runtimeRecordPipe,
	heartbeat: runtimeRecordPipe,
	expiresAt: isoDateTimePipe,
})
export type ActiveDispatchAttempt = PipeOutput<typeof activeDispatchAttemptPipe>

export const dispatchAttemptHistoryPipe = v.object({
	number: positiveIntegerPipe,
	started: runtimeRecordPipe,
	ended: runtimeRecordPipe,
	outcome: v.discriminate((value) => value.type, {
		completed: v.object({
			type: v.eq('completed'),
			outcome: v.in(['processed', 'stale-no-op', 'no-longer-applicable']),
		}),
		waiting: v.object({ type: v.eq('waiting'), prerequisite: dispatchWaitingPrerequisitePipe }),
		rescheduled: v.object({
			type: v.eq('rescheduled'),
			eligibleAt: isoDateTimePipe,
			category: safeDispatchCategoryPipe,
			summary: safeDispatchSummaryPipe,
		}),
		interrupted: v.object({
			type: v.eq('interrupted'),
			reason: v.in(['lease-expired', 'processor-shutdown', 'snapshot-restored']),
		}),
		failed: v.object({ type: v.eq('failed'), failure: safeDispatchFailurePipe }),
	}),
})
export type DispatchAttemptHistory = PipeOutput<typeof dispatchAttemptHistoryPipe>

export const dispatchLifecycleTypePipe = v.in(['pending', 'waiting', 'leased', 'completed', 'failed'])
export type DispatchLifecycleType = PipeOutput<typeof dispatchLifecycleTypePipe>

export const dispatchLifecyclePipe = v.discriminate((value) => value.type, {
	pending: v.object({ type: v.eq('pending'), eligibleAt: isoDateTimePipe }),
	waiting: v.object({ type: v.eq('waiting'), since: runtimeRecordPipe, prerequisite: dispatchWaitingPrerequisitePipe }),
	leased: v.object({ type: v.eq('leased'), attempt: activeDispatchAttemptPipe }),
	completed: v.object({
		type: v.eq('completed'),
		completed: runtimeRecordPipe,
		outcome: v.in(['processed', 'stale-no-op', 'no-longer-applicable']),
	}),
	failed: v.object({ type: v.eq('failed'), failed: runtimeRecordPipe, failure: safeDispatchFailurePipe }),
})
export type DispatchLifecycle = PipeOutput<typeof dispatchLifecyclePipe>

export const dispatchRequestSchema = coreSchema('dispatch_requests')
	.field('payload', dispatchRequestPayloadPipe)
	.field('reasons', v.array(dispatchReasonPipe).pipe(v.min(1), v.max(maxDispatchReasons)))
	.field('deduplicationKey', v.nullable(dispatchDeduplicationKeyPipe))
	.field('coordinationClaims', v.array(dispatchCoordinationClaimPipe).pipe(v.min(1)))
	.field('accepted', runtimeRecordPipe)
	.field('attemptCount', nonNegativeIntegerPipe)
	.field('expiredLeaseCount', nonNegativeIntegerPipe)
	.field('attempts', v.array(dispatchAttemptHistoryPipe).pipe(v.max(maxDispatchAttemptHistory)))
	.field('lifecycle', dispatchLifecyclePipe)
	.build()
const storedDispatchRequestPipe = schemaToPipe(dispatchRequestSchema)
export const dispatchRequestPipe = storedDispatchRequestPipe.pipe(
	v.custom((request) => dispatchIdentityIsConsistent(request) && dispatchAttemptCountersAreConsistent(request)),
)
export type DispatchRequest = PipeOutput<typeof dispatchRequestPipe>

export interface DispatchRequestInput {
	payload: DispatchRequestPayload
	reason: DispatchReason
	coordinationClaims: DispatchCoordinationClaim[]
	deduplicationKey: DispatchDeduplicationKey | null
}

export const dispatchRequestInputPipe = v
	.object({
		payload: dispatchRequestPayloadPipe,
		reason: dispatchReasonPipe,
		coordinationClaims: v.array(dispatchCoordinationClaimPipe).pipe(v.min(1)),
		deduplicationKey: v.nullable(dispatchDeduplicationKeyPipe),
	})
	.pipe(v.custom((input: DispatchRequestInput) => dispatchIdentityIsConsistent(input))) as Pipe<
	DispatchRequestInput,
	DispatchRequestInput
>

function dispatchIdentityIsConsistent(input: {
	payload: DispatchRequestPayload
	deduplicationKey: DispatchDeduplicationKey | null
}): boolean {
	switch (input.payload.type) {
		case 'agent-run-preparation':
			return (
				input.deduplicationKey?.type === 'agent-run-preparation' && input.deduplicationKey.agentRunId === input.payload.agentRunId
			)
		case 'agent-run-sandbox-release':
			return (
				input.deduplicationKey?.type === 'agent-run-sandbox-release' &&
				input.deduplicationKey.agentRunId === input.payload.agentRunId
			)
		case 'delivery-work-scheduler':
			return (
				input.deduplicationKey?.type === 'delivery-work-scheduler' && input.deduplicationKey.deliveryId === input.payload.deliveryId
			)
		case 'agent-run-model-turn':
		case 'delivery-work-operation':
			return input.deduplicationKey === null
		default:
			throw new Error('Unhandled Dispatch Request identity.')
	}
}

function dispatchAttemptCountersAreConsistent(request: {
	attemptCount: number
	expiredLeaseCount: number
	attempts: DispatchAttemptHistory[]
	lifecycle: DispatchLifecycle
}): boolean {
	if (request.expiredLeaseCount > request.attemptCount) return false
	let previousAttemptNumber = 0
	for (const attempt of request.attempts) {
		if (attempt.number <= previousAttemptNumber || attempt.number > request.attemptCount) return false
		previousAttemptNumber = attempt.number
	}
	return request.lifecycle.type !== 'leased' || request.lifecycle.attempt.number === request.attemptCount
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	const id = (sequence: number) => `01k000000000000000000${sequence.toString().padStart(5, '0')}`
	const at = '2026-07-13T12:00:00.000Z'
	const baseRequest = {
		id: id(1),
		reasons: [{ type: 'agent-run-created' }] as const,
		deduplicationKey: { type: 'agent-run-preparation', agentRunId: id(2) } as const,
		coordinationClaims: [{ scope: [{ type: 'agent-run', id: id(2) }], mode: { type: 'exclusive' } }] as const,
		accepted: { at },
		attemptCount: 0,
		expiredLeaseCount: 0,
		attempts: [],
		lifecycle: { type: 'pending', eligibleAt: at } as const,
	}

	describe('Dispatch Request', () => {
		it('accepts a pending Agent Run Preparation request', () => {
			expect(
				v.validate(dispatchRequestPipe, {
					...baseRequest,
					payload: { type: 'agent-run-preparation', agentRunId: id(2) },
				}),
			).toMatchObject({
				valid: true,
				value: {
					payload: { type: 'agent-run-preparation', agentRunId: id(2) },
					lifecycle: { type: 'pending', eligibleAt: at },
				},
			})
		})

		it('accepts every payload and lifecycle variant', () => {
			const payloads: DispatchRequestPayload[] = [
				{ type: 'agent-run-model-turn', agentRunId: id(2) },
				{ type: 'agent-run-preparation', agentRunId: id(2) },
				{ type: 'agent-run-sandbox-release', agentRunId: id(2) },
				{ type: 'delivery-work-scheduler', deliveryId: id(3) },
				{
					type: 'delivery-work-operation',
					deliveryId: id(3),
					operation: { scope: 'delivery', state: 'needs-artifact-creation' },
					operationId: id(4),
				},
			]
			const lifecycles: DispatchLifecycle[] = [
				{ type: 'pending', eligibleAt: at },
				{
					type: 'waiting',
					since: { at },
					prerequisite: { type: 'agent-run-preparation', agentRunId: id(2) },
				},
				{
					type: 'leased',
					attempt: {
						number: 1,
						token: 'attempt-token',
						coordinationEpoch: 0,
						claimed: { at },
						heartbeat: { at },
						expiresAt: at,
					},
				},
				{ type: 'completed', completed: { at }, outcome: 'processed' },
				{ type: 'failed', failed: { at }, failure: { category: 'handler', summary: 'Safe failure.' } },
			]

			for (const payload of payloads) {
				const identity = (() => {
					switch (payload.type) {
						case 'agent-run-model-turn':
							return { reasons: [{ type: 'input-appended' as const, inputEventId: id(5) }], deduplicationKey: null }
						case 'agent-run-preparation':
							return {
								reasons: [{ type: 'agent-run-created' as const }],
								deduplicationKey: { type: 'agent-run-preparation' as const, agentRunId: payload.agentRunId },
							}
						case 'agent-run-sandbox-release':
							return {
								reasons: [{ type: 'agent-run-completed' as const }],
								deduplicationKey: { type: 'agent-run-sandbox-release' as const, agentRunId: payload.agentRunId },
							}
						case 'delivery-work-scheduler':
							return {
								reasons: [{ type: 'delivery-work-requested' as const }],
								deduplicationKey: { type: 'delivery-work-scheduler' as const, deliveryId: payload.deliveryId },
							}
						case 'delivery-work-operation':
							return {
								reasons: [{ type: 'delivery-work-operation-queued' as const, operationId: payload.operationId }],
								deduplicationKey: null,
							}
						default:
							throw new Error('Unhandled test Dispatch payload.')
					}
				})()
				for (const lifecycle of lifecycles) {
					expect(
						v.validate(dispatchRequestPipe, {
							...baseRequest,
							...identity,
							payload,
							lifecycle,
							attemptCount: lifecycle.type === 'leased' ? 1 : 0,
						}).valid,
					).toBe(true)
				}
			}
		})

		it('rejects empty claims, invalid capacity, raw failure data, and negative counters', () => {
			const request = { ...baseRequest, payload: { type: 'agent-run-preparation', agentRunId: id(2) } }
			expect(v.validate(dispatchRequestPipe, { ...request, coordinationClaims: [] }).valid).toBe(false)
			expect(
				v.validate(dispatchRequestPipe, {
					...request,
					coordinationClaims: [{ scope: [{ type: 'agent-run', id: id(2) }], mode: { type: 'shared-capacity', capacity: 0 } }],
				}).valid,
			).toBe(false)
			expect(
				v.validate(dispatchRequestPipe, {
					...request,
					lifecycle: {
						type: 'failed',
						failed: { at },
						failure: { category: 'handler', summary: 'Safe failure.', cause: new Error('secret') },
					},
				}).valid,
			).toBe(false)
			expect(v.validate(dispatchRequestPipe, { ...request, attemptCount: -1 }).valid).toBe(false)
			expect(v.validate(dispatchRequestPipe, { ...request, expiredLeaseCount: -1 }).valid).toBe(false)
			expect(
				v.validate(dispatchRequestPipe, {
					...request,
					payload: { type: 'delivery-work-scheduler', deliveryId: id(3) },
				}).valid,
			).toBe(false)
			expect(
				v.validate(dispatchRequestPipe, {
					...request,
					attemptCount: 1,
					lifecycle: {
						type: 'leased',
						attempt: {
							number: 2,
							token: 'token',
							coordinationEpoch: 0,
							claimed: { at },
							heartbeat: { at },
							expiresAt: at,
						},
					},
				}).valid,
			).toBe(false)
		})

		it('accepts compacted history while preserving larger durable counters', () => {
			const request = {
				...baseRequest,
				payload: { type: 'agent-run-preparation', agentRunId: id(2) },
				attemptCount: 65,
				expiredLeaseCount: 5,
				attempts: Array.from({ length: maxDispatchAttemptHistory }, (_, index) => ({
					number: index + 2,
					started: { at },
					ended: { at },
					outcome: { type: 'interrupted', reason: 'lease-expired' },
				})),
			}

			expect(v.validate(dispatchRequestPipe, request).valid).toBe(true)
			expect(
				v.validate(dispatchRequestPipe, {
					...request,
					attempts: [...request.attempts, request.attempts[0]],
				}).valid,
			).toBe(false)
		})
	})
}
