import { v, type PipeOutput } from 'valleyed'

import { readSchedulerWork, type SchedulerWorkClaim } from './preflight'
import type { DeliveryWorkOperation } from '../../domain/action'
import { idPipe } from '../../domain/commons'
import type { SliceWorkState } from '../../domain/slice'
import type { InvalidInputError } from '../../errors'
import { getSliceState } from '../../utils/delivery-context'
import { deliverySliceOperationClaims, exclusiveDeliveryClaim } from '../../utils/dispatch'
import type { CoreRuntime } from '../../utils/runtime'
import { nextId, runtimeRecord } from '../../utils/runtime-values'
import { createRecord } from '../../utils/storage/helpers'
import type { Result as CoreResult } from '../../utils/types'
import { buildWorkHandler } from '../../utils/work-handler'
import { deliveryOperationFromState, queuedDeliveryWorkDispatchAction, sliceOperationFromState } from '../delivery-work/dispatch-actions'
import type { Error, Result } from '../delivery-work/types'
import type { WorkContext } from '../types'

export type {
	DeliveryWorkFailure,
	DeliveryWorkFailureOperation,
	DeliveryWorkNoObservedChangeTarget,
	Error,
	Result,
} from '../delivery-work/types'

const scheduleDeliveryWorkInputPipe = v.object({ deliveryId: idPipe })
export type Input = PipeOutput<typeof scheduleDeliveryWorkInputPipe>

export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createScheduleDeliveryWorkOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('scheduleDeliveryWork', scheduleDeliveryWorkInputPipe, async (input) => {
		const read = await runtime.transactions.run(({ storage }) => readSchedulerWork(runtime, storage, input.deliveryId))
		if (!read.ok) return read
		if (read.value.type === 'result') return { ok: true, value: read.value.result }

		const deliveryOperation = deliveryOperationFromState(read.value.state)
		const operations =
			deliveryOperation !== null
				? { ok: true as const, value: [deliveryOperation] }
				: read.value.state.type === 'slices-incomplete'
					? sliceOperationsForClaim(read.value)
					: { ok: true as const, value: [] }
		if (!operations.ok) return operations
		if (operations.value.length === 0) return { ok: true, value: completed() }

		const queued = await queueOperations(runtime, read.value, operations.value)
		return queued.ok ? { ok: true, value: completed(queued.value) } : queued
	})
}

function sliceOperationsForClaim(claim: SchedulerWorkClaim): CoreResult<DeliveryWorkOperation[], Exclude<Error, InvalidInputError>> {
	const candidates: Array<{ operation: DeliveryWorkOperation; order: number; priority: SliceActionPriority }> = []
	let inTransitCount = 0

	for (const [order, deliverySlice] of claim.deliveryContext.slices.entries()) {
		const state = getSliceState(claim.deliveryContext, deliverySlice.slice.id)
		if (!state.ok) return state
		if (state.value.type === 'operation-running' || state.value.type === 'operation-queued') {
			inTransitCount += 1
			continue
		}

		const operation = sliceOperationFromState(deliverySlice.slice.id, state.value)
		const priority = sliceActionPriority(state.value)
		if (operation !== null && priority !== null) candidates.push({ operation, order, priority })
	}

	const availableSlots = Math.max(0, claim.workResolution.workConfig.maxProcessableSliceSlots - inTransitCount)
	return {
		ok: true,
		value: candidates
			.sort((left, right) => left.priority - right.priority || left.order - right.order)
			.slice(0, availableSlots)
			.map((candidate) => candidate.operation),
	}
}

type SliceActionPriority = 0 | 1 | 2 | 3 | 4

function sliceActionPriority(state: SliceWorkState): SliceActionPriority | null {
	switch (state.type) {
		case 'needs-delivery-validation':
			return 0
		case 'needs-artifact-validation':
			return 1
		case 'needs-review-surface':
			return 2
		case 'needs-artifact-creation':
			return 3
		case 'executable':
			return 4
		case 'complete':
		case 'operation-running':
		case 'operation-queued':
		case 'dependency-blocked':
		case 'correction-blocked':
		case 'awaiting-review':
		case 'slice-operation-failed':
			return null
		default:
			throw new Error(`Unexpected Slice Work State: ${String(state satisfies never)}`)
	}
}

async function queueOperations(
	runtime: CoreRuntime,
	claim: SchedulerWorkClaim,
	operations: DeliveryWorkOperation[],
): Promise<CoreResult<number, Exclude<Error, InvalidInputError>>> {
	return runtime.transactions.run<number, Exclude<Error, InvalidInputError>>(async ({ storage, dispatch }) => {
		const requests: Array<ReturnType<typeof dispatch.request>> = []
		for (const operation of operations) {
			const actionId = nextId(runtime.values)
			if (!actionId.ok) return actionId

			const performed = runtimeRecord(runtime.values)
			if (!performed.ok) return performed

			const action = queuedDeliveryWorkDispatchAction({
				actionId: actionId.value,
				deliveryId: claim.deliveryContext.delivery.id,
				performed: performed.value,
				operation,
			})
			const put = await createRecord('action', storage, action)
			if (!put.ok) return put

			requests.push(
				dispatch.request({
					type: 'delivery-work-operation',
					deliveryId: claim.deliveryContext.delivery.id,
					queuedActionId: action.id,
					operation,
					coordinationClaims: coordinationClaimsForOperation(claim, operation),
					reason: { type: 'delivery-work-operation-queued', queuedActionId: action.id },
				}),
			)
		}

		for (const request of requests) {
			const accepted = await request
			if (!accepted.ok) return accepted
		}
		return { ok: true, value: operations.length }
	})
}

function coordinationClaimsForOperation(claim: SchedulerWorkClaim, operation: DeliveryWorkOperation) {
	switch (operation.scope) {
		case 'delivery':
			return [exclusiveDeliveryClaim(claim.deliveryContext.delivery.id)]
		case 'slice':
			return deliverySliceOperationClaims(
				claim.deliveryContext.delivery.id,
				operation.sliceId,
				claim.workResolution.workConfig.maxProcessableSliceSlots,
			)
		default:
			throw new Error(`Unexpected Delivery Work Operation scope: ${String(operation satisfies never)}`)
	}
}

function completed(processedCount = 0): Result {
	return { processedCount, failures: [] }
}

if (import.meta.vitest) {
	const { describe, expect, it, vi } = import.meta.vitest
	const {
		createTestCoreRuntime,
		createTestCoreServices,
		localStamp,
		neverCalledProviderBackedPreflightProviders,
		seedAgentRunProfile,
		seedDelivery,
		seedProject,
		seedSecret,
		seedSelectableModel,
		seedSlice,
	} = await import('../../utils/test-helpers')

	const workContext: WorkContext = { correlationId: 'correlation-1' }

	describe('scheduleDeliveryWork work operation', () => {
		it('validates input before reading storage', async () => {
			const options = createTestCoreServices()
			const operation = createScheduleDeliveryWorkOperation(createTestCoreRuntime(options))

			const result = await operation({} as never, workContext)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-input', boundary: 'work', operation: 'scheduleDeliveryWork' },
			})
			expect(options.transactionCalls()).toBe(0)
		})

		it('queues a Delivery-level operation dispatch request', async () => {
			const dispatches: unknown[] = []
			const readyMarkers: string[] = []
			const options = providerPreflightFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return Promise.resolve('marker-1')
					},
					ready: (marker) => {
						readyMarkers.push(marker)
					},
				},
			})
			const operation = createScheduleDeliveryWorkOperation(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await operation({ deliveryId: '01k00000000000000000000008' }, workContext)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect([...options.tx.actions.records.values()].map((action) => action.result)).toEqual([
				{ type: 'queue-delivery-work-operation', operation: { scope: 'delivery', state: 'needs-artifact-creation' } },
			])
			expect(dispatches).toEqual([
				{
					type: 'delivery-work-operation',
					deliveryId: '01k00000000000000000000008',
					queuedActionId: '01k00000000000000000010001',
					operation: { scope: 'delivery', state: 'needs-artifact-creation' },
					coordinationClaims: [{ scope: [{ type: 'delivery', id: '01k00000000000000000000008' }], mode: { type: 'exclusive' } }],
					reason: { type: 'delivery-work-operation-queued', queuedActionId: '01k00000000000000000010001' },
				},
			])
			expect(readyMarkers).toEqual(['marker-1'])
		})

		it('records local Delivery preflight failures without running provider-backed checks', async () => {
			const options = providerPreflightFixture()
			options.tx.agentRunProfiles.records.get('01k00000000000000000000006')!.archivePeriods = [
				{ archived: localStamp(), unarchived: null },
			]
			const operation = createScheduleDeliveryWorkOperation(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await operation({ deliveryId: '01k00000000000000000000008' }, workContext)

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(options.tx.actions.records.get('01k00000000000000000010001')?.result).toMatchObject({
				type: 'validate-preflight',
				checks: [{ passed: false, summary: 'Selected Delivery execution Agent Run Profile is archived.' }],
			})
		})

		it('queues up to available Slice slots and readies asynchronously accepted requests in invocation order', async () => {
			const dispatches: unknown[] = []
			const readyMarkers: string[] = []
			const acceptRequests: Array<(marker: string) => void> = []
			const options = providerPreflightFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: (request) => {
						dispatches.push(request)
						return new Promise<string>((resolve) => acceptRequests.push(resolve))
					},
					ready: (marker) => readyMarkers.push(marker),
				},
			})
			seedSliceSchedulingFixture(options)
			const operation = createScheduleDeliveryWorkOperation(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const running = operation({ deliveryId: '01k00000000000000000000008' }, workContext)
			await vi.waitFor(() => expect(dispatches).toHaveLength(2))
			acceptRequests[1]?.('marker-2')
			acceptRequests[0]?.('marker-1')
			const result = await running

			expect(result).toEqual({ ok: true, value: { processedCount: 2, failures: [] } })
			expect(dispatches).toHaveLength(2)
			expect(readyMarkers).toEqual(['marker-1', 'marker-2'])
			expect([...options.tx.actions.records.values()].map((action) => action.result.type)).toEqual([
				'queue-delivery-work-operation',
				'queue-delivery-work-operation',
			])
		})

		it('rolls back every queued Action and readiness effect when one Dispatch request is invalid', async () => {
			const readyMarkers: string[] = []
			let requestCount = 0
			const options = providerPreflightFixture({
				dispatcher: {
					preflight: () => Promise.resolve({ ok: true }),
					request: () => {
						requestCount += 1
						return Promise.resolve(requestCount === 1 ? 'marker-1' : ' ')
					},
					ready: (marker) => readyMarkers.push(marker),
				},
			})
			seedSliceSchedulingFixture(options)
			const operation = createScheduleDeliveryWorkOperation(
				createTestCoreRuntime(options, { providers: neverCalledProviderBackedPreflightProviders() }),
			)

			const result = await operation({ deliveryId: '01k00000000000000000000008' }, workContext)

			expect(result).toMatchObject({
				ok: false,
				error: { type: 'invalid-core-service-output', service: 'dispatcher', operation: 'request' },
			})
			expect(options.tx.actions.records.size).toBe(0)
			expect(readyMarkers).toEqual([])
		})
	})

	function seedSliceSchedulingFixture(options: ReturnType<typeof createTestCoreServices>) {
		options.tx.deliveryArtifacts.records.set('01k00000000000000000000010', {
			id: '01k00000000000000000000010',
			deliveryId: '01k00000000000000000000008',
			config: { type: 'source-control', deliveryBranch: 'delivery' },
			created: localStamp(),
		})
		seedSlice(options.tx, '01k00000000000000000000042', '01k00000000000000000000008')
		seedSlice(options.tx, '01k00000000000000000000043', '01k00000000000000000000008')
		options.tx.projects.records.get('01k00000000000000000000030')!.config.value.work.maxProcessableSliceSlots = 2
	}

	function providerPreflightFixture(overrides: Parameters<typeof createTestCoreServices>[0] = {}) {
		const options = createTestCoreServices(overrides)
		seedProject(options.tx, '01k00000000000000000000030')
		seedSecret(options.tx, '01k00000000000000000000040')
		seedSelectableModel(options.tx, '01k00000000000000000000024')
		seedAgentRunProfile(options.tx, '01k00000000000000000000006', '01k00000000000000000000024')
		seedDelivery(options.tx, '01k00000000000000000000008')
		options.tx.deliveries.records.get('01k00000000000000000000008')!.queued = localStamp()
		return options
	}
}
