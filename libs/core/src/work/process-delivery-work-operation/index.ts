import { v, type PipeOutput } from 'valleyed'

import { acceptDispatchRequest, exclusiveDeliverySchedulerClaim } from '../../commands/utils/dispatch'
import { deliveryWorkOperationPipe, type Action, type DeliveryWorkOperation } from '../../domain/action'
import { idPipe, type Id } from '../../domain/commons'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreRuntime } from '../../runtime'
import { handleDeliveryNeedsArtifactCreation } from './handlers/delivery-needs-artifact-creation'
import { handleDeliveryNeedsArtifactValidation } from './handlers/delivery-needs-artifact-validation'
import { handleDeliveryNeedsReviewSurface } from './handlers/delivery-needs-review-surface'
import { handleSliceExecutable } from './handlers/slice-executable'
import { handleSliceNeedsArtifactCreation } from './handlers/slice-needs-artifact-creation'
import { handleSliceNeedsArtifactValidation } from './handlers/slice-needs-artifact-validation'
import { handleSliceNeedsDeliveryValidation } from './handlers/slice-needs-delivery-validation'
import { handleSliceNeedsReviewSurface } from './handlers/slice-needs-review-surface'
import { createRecord, getRequired, listRecords, withTransaction } from '../../storage/helpers'
import { buildDeliveryContext, getDeliveryState, getSliceState, type DeliveryContext } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryWorkResolution,
	providerBackedRepositoryAccessSecret,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
} from '../../utils/delivery-preflight'
import { nextId, runtimeRecord } from '../../utils/runtime-values'
import type { Result as CoreResult } from '../../utils/types'
import {
	deliveryOperationFromState,
	processedDeliveryWorkDispatchAction,
	staleNoopDeliveryWorkDispatchAction,
	startedDeliveryWorkDispatchAction,
	sliceOperationFromState,
} from '../delivery-work/dispatch-actions'
import type {
	DeliveryWorkHandlerResult,
	DeliveryWorkHandlerSuccess,
	Error,
	ResolvedDeliveryHandlerContext,
	Result,
} from '../delivery-work/types'
import type { WorkContext } from '../types'
import { buildWorkHandler } from '../utils/handler'

const processDeliveryWorkOperationInputPipe = v.object({
	deliveryId: idPipe,
	queuedActionId: idPipe,
	operation: deliveryWorkOperationPipe,
})
type RawInput = PipeOutput<typeof processDeliveryWorkOperationInputPipe>
export type Input = Omit<RawInput, 'operation'> & { operation: DeliveryWorkOperation }
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createProcessDeliveryWorkOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('processDeliveryWorkOperation', processDeliveryWorkOperationInputPipe, (input) =>
		handleProcessDeliveryWorkOperation(runtime, input as Input),
	)
}

async function handleProcessDeliveryWorkOperation(
	runtime: CoreRuntime,
	input: Input,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const started = await withTransaction(runtime.services, (storage) => recordStartedDispatchAction(runtime, storage, input))
	if (!started.ok) return started
	if (started.value.type === 'already-started') return { ok: true, value: completed() }

	const startedActionId = started.value.action.id
	const current = await withTransaction(runtime.services, (storage) => readCurrentOperation(storage, input, startedActionId))
	if (!current.ok) return current
	if (!operationsEqual(current.value.operation, input.operation)) {
		return finishAndRequestScheduler(runtime, input, startedActionId, 'stale-no-op', completed(1))
	}

	const preflight = await runProcessorPreflight(runtime, current.value.deliveryContext)
	if (!preflight.ok) return preflight
	if (!deliveryPreflightChecksPassed(preflight.value.checks)) {
		return writeFailedPreflightFinishAndRequestScheduler(runtime, input, startedActionId, preflight.value.checks)
	}

	const handled = await processFreshOperation(runtime, input, startedActionId, current.value.deliveryContext, preflight.value.context)
	if (!handled.ok) return handled

	const result = deliveryWorkResult(handled.value)
	return finishAndRequestScheduler(runtime, input, startedActionId, 'processed', result.value, result.dispatchMarkers)
}

type StartedAttempt = { type: 'started'; action: Action } | { type: 'already-started' }

async function recordStartedDispatchAction(
	runtime: CoreRuntime,
	storage: Parameters<Parameters<typeof withTransaction>[1]>[0],
	input: Input,
): Promise<CoreResult<StartedAttempt, Exclude<Error, InvalidInputError>>> {
	const queued = await getRequired('action', storage, input.queuedActionId)
	if (!queued.ok) return queued
	if (queued.value.deliveryId !== input.deliveryId) {
		return invariant(`Queued Delivery Work Dispatch Action ${input.queuedActionId} is not for Delivery ${input.deliveryId}.`)
	}
	if (queued.value.result.type !== 'queue-delivery-work-operation') {
		return invariant(`Action ${input.queuedActionId} is not a queued Delivery Work Dispatch Action.`)
	}
	if (!operationsEqual(queued.value.result.operation, input.operation)) {
		return invariant(`Delivery Work Operation request does not match queued Action ${input.queuedActionId}.`)
	}

	const existingStarted = await startedActionForQueuedAction(storage, input.deliveryId, input.queuedActionId)
	if (!existingStarted.ok) return existingStarted
	if (existingStarted.value !== null) return { ok: true, value: { type: 'already-started' } }

	const actionId = nextId(runtime.values, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(runtime.values)
	if (!performed.ok) return performed

	const action = startedDeliveryWorkDispatchAction({
		actionId: actionId.value,
		deliveryId: input.deliveryId,
		performed: performed.value,
		queuedActionId: input.queuedActionId,
		operation: input.operation,
	})
	const put = await createRecord('action', storage, action)
	return put.ok ? { ok: true, value: { type: 'started', action } } : put
}

async function startedActionForQueuedAction(
	storage: Parameters<Parameters<typeof withTransaction>[1]>[0],
	deliveryId: Id,
	queuedActionId: Id,
): Promise<CoreResult<Action | null, Exclude<Error, InvalidInputError>>> {
	const actions = await listRecords('action', storage, { where: (filter, fields) => filter.eq(fields.deliveryId, deliveryId) })
	if (!actions.ok) return actions

	return {
		ok: true,
		value:
			actions.value.find(
				(action) => action.result.type === 'start-delivery-work-operation' && action.result.queuedActionId === queuedActionId,
			) ?? null,
	}
}

async function readCurrentOperation(
	storage: Parameters<Parameters<typeof withTransaction>[1]>[0],
	input: Input,
	startedActionId: Id,
): Promise<CoreResult<{ deliveryContext: DeliveryContext; operation: DeliveryWorkOperation | null }, Exclude<Error, InvalidInputError>>> {
	const deliveryContext = await buildDeliveryContext(storage, input.deliveryId)
	if (!deliveryContext.ok) return deliveryContext

	const filteredContext = withoutOwnDispatchActions(deliveryContext.value, input.queuedActionId, startedActionId)
	const operation = currentOperation(filteredContext, input.operation)
	return operation.ok ? { ok: true, value: { deliveryContext: filteredContext, operation: operation.value } } : operation
}

function withoutOwnDispatchActions(context: DeliveryContext, queuedActionId: Id, startedActionId: Id): DeliveryContext {
	return {
		...context,
		actions: context.actions.filter((action) => !isOwnDispatchAction(action, queuedActionId, startedActionId)),
	}
}

function isOwnDispatchAction(action: Action, queuedActionId: Id, startedActionId: Id): boolean {
	switch (action.result.type) {
		case 'queue-delivery-work-operation':
			return action.id === queuedActionId
		case 'start-delivery-work-operation':
			return action.id === startedActionId || action.result.queuedActionId === queuedActionId
		case 'finish-delivery-work-operation':
			return action.result.startedActionId === startedActionId
		default:
			return false
	}
}

function currentOperation(
	context: DeliveryContext,
	operation: DeliveryWorkOperation,
): CoreResult<DeliveryWorkOperation | null, Exclude<Error, InvalidInputError>> {
	switch (operation.scope) {
		case 'delivery': {
			const state = getDeliveryState(context)
			return state.ok ? { ok: true, value: deliveryOperationFromState(state.value) } : state
		}
		case 'slice': {
			const state = getSliceState(context, operation.sliceId)
			return state.ok ? { ok: true, value: sliceOperationFromState(operation.sliceId, state.value) } : state
		}
		default:
			throw new Error(`Unexpected Delivery Work Operation scope: ${String(operation satisfies never)}`)
	}
}

async function runProcessorPreflight(
	runtime: CoreRuntime,
	deliveryContext: DeliveryContext,
): Promise<CoreResult<{ checks: ValidationEvidence[]; context: ResolvedDeliveryHandlerContext }, Exclude<Error, InvalidInputError>>> {
	const plan = await withTransaction(runtime.services, (storage) => readProviderBackedDeliveryPreflightPlan(storage, deliveryContext))
	if (!plan.ok) return plan

	const checks = await runProviderBackedDeliveryPreflightChecks(runtime, plan.value)
	if (!checks.ok) return checks

	const workResolution = providerBackedDeliveryWorkResolution(plan.value)
	const repositoryAccessSecret = providerBackedRepositoryAccessSecret(plan.value)
	return workResolution === undefined || repositoryAccessSecret === undefined
		? {
				ok: true,
				value: {
					checks: checks.value,
					context: unresolvedHandlerContext(runtime, deliveryContext) as ResolvedDeliveryHandlerContext,
				},
			}
		: {
				ok: true,
				value: {
					checks: checks.value,
					context: {
						services: runtime.services,
						storage: runtime.services.storage,
						values: runtime.values,
						deliveryContext,
						workResolution,
						repositoryAccessSecret,
					},
				},
			}
}

function unresolvedHandlerContext(runtime: CoreRuntime, deliveryContext: DeliveryContext) {
	return {
		services: runtime.services,
		storage: runtime.services.storage,
		values: runtime.values,
		deliveryContext,
	}
}

async function processFreshOperation(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
	_deliveryContext: DeliveryContext,
	context: ResolvedDeliveryHandlerContext,
): Promise<DeliveryWorkHandlerResult> {
	const operationContext = { ...context, dispatchStartedActionId: startedActionId }
	switch (input.operation.scope) {
		case 'delivery':
			return processFreshDeliveryOperation(runtime, input.operation, operationContext)
		case 'slice':
			return processFreshSliceOperation(runtime, input.operation, operationContext)
		default:
			throw new Error(`Unexpected Delivery Work Operation scope: ${String(input.operation satisfies never)}`)
	}
}

async function processFreshDeliveryOperation(
	runtime: CoreRuntime,
	operation: Extract<DeliveryWorkOperation, { scope: 'delivery' }>,
	context: ResolvedDeliveryHandlerContext,
): Promise<DeliveryWorkHandlerResult> {
	switch (operation.state) {
		case 'needs-artifact-creation':
			return handleDeliveryNeedsArtifactCreation(runtime, context, { type: 'needs-artifact-creation' })
		case 'needs-artifact-validation':
			return withTransaction(runtime.services, async (storage) =>
				handleDeliveryNeedsArtifactValidation({ ...context, storage }, { type: 'needs-artifact-validation' }),
			)
		case 'needs-review-surface': {
			const deliveryArtifactId = context.deliveryContext.deliveryArtifact?.id
			return deliveryArtifactId === undefined
				? invariant('Delivery Review Surface creation requires a Delivery Artifact.')
				: handleDeliveryNeedsReviewSurface(runtime, context, { type: 'needs-review-surface', deliveryArtifactId })
		}
		default:
			throw new Error(`Unexpected Delivery Work Operation state: ${String(operation.state satisfies never)}`)
	}
}

async function processFreshSliceOperation(
	runtime: CoreRuntime,
	operation: Extract<DeliveryWorkOperation, { scope: 'slice' }>,
	context: ResolvedDeliveryHandlerContext,
): Promise<DeliveryWorkHandlerResult> {
	const deliverySlice = context.deliveryContext.slices.find((candidate) => candidate.slice.id === operation.sliceId)
	if (deliverySlice === undefined) return invariant(`Slice ${operation.sliceId} is missing from Delivery Context.`)

	switch (operation.state) {
		case 'needs-delivery-validation':
			return withTransaction(runtime.services, async (storage) =>
				handleSliceNeedsDeliveryValidation({ ...context, storage }, deliverySlice.slice, {
					type: 'needs-delivery-validation',
					actionId: operation.detail?.type === 'action' ? operation.detail.actionId : '',
				}),
			)
		case 'needs-artifact-validation': {
			const sliceArtifactId = operation.detail?.type === 'artifact' ? operation.detail.artifactId : deliverySlice.artifact?.id
			return sliceArtifactId === undefined
				? invariant(`Slice ${operation.sliceId} Artifact is missing from Delivery Context.`)
				: withTransaction(runtime.services, async (storage) =>
						handleSliceNeedsArtifactValidation({ ...context, storage }, deliverySlice.slice, {
							type: 'needs-artifact-validation',
							mode: 'initial',
							sliceArtifactId,
						}),
					)
		}
		case 'needs-review-surface': {
			const sliceArtifactId = operation.detail?.type === 'artifact' ? operation.detail.artifactId : deliverySlice.artifact?.id
			return sliceArtifactId === undefined
				? invariant(`Slice ${operation.sliceId} Artifact is missing from Delivery Context.`)
				: handleSliceNeedsReviewSurface(runtime, context, deliverySlice.slice, { type: 'needs-review-surface', sliceArtifactId })
		}
		case 'needs-artifact-creation':
			return handleSliceNeedsArtifactCreation(runtime, context, deliverySlice.slice, { type: 'needs-artifact-creation' })
		case 'executable':
			return withTransaction(runtime.services, async (storage) =>
				handleSliceExecutable(
					{ ...context, storage },
					deliverySlice.slice,
					executableStateForOperation(operation.detail),
					context.workResolution,
				),
			)
		default:
			throw new Error(`Unexpected Slice Work Operation state: ${String(operation.state satisfies never)}`)
	}
}

type SliceDeliveryWorkOperation = Extract<DeliveryWorkOperation, { scope: 'slice' }>

type SliceDeliveryWorkOperationDetail = SliceDeliveryWorkOperation extends { detail?: infer Detail } ? Detail : never

function executableStateForOperation(detail: SliceDeliveryWorkOperationDetail | undefined): Parameters<typeof handleSliceExecutable>[2] {
	return detail?.type === 'correction-root'
		? { type: 'executable', mode: 'correction', failureChain: { rootActionId: detail.actionId, correctionRetries: 0 } }
		: { type: 'executable', mode: 'initial' }
}

async function writeFailedPreflightFinishAndRequestScheduler(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const written = await withTransaction(runtime.services, async (storage) => {
		const preflightId = nextId(runtime.values, 'action')
		if (!preflightId.ok) return preflightId
		const preflightPerformed = runtimeRecord(runtime.values)
		if (!preflightPerformed.ok) return preflightPerformed

		const preflightAction: Action = {
			id: preflightId.value,
			deliveryId: input.deliveryId,
			performed: preflightPerformed.value,
			authorized: null,
			result: { type: 'validate-preflight', checks },
		}
		const preflightPut = await createRecord('action', storage, preflightAction)
		if (!preflightPut.ok) return preflightPut

		return writeFinishAndAcceptSchedulerRequest(runtime, storage, input, startedActionId, 'processed')
	})
	if (!written.ok) return written

	runtime.services.dispatcher.ready(written.value.marker)
	return { ok: true, value: completed(1) }
}

async function finishAndRequestScheduler(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
	outcome: 'processed' | 'stale-no-op',
	result: Result,
	dispatchMarkers: string[] = [],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	const written = await withTransaction(runtime.services, (storage) =>
		writeFinishAndAcceptSchedulerRequest(runtime, storage, input, startedActionId, outcome),
	)
	if (!written.ok) return written

	runtime.services.dispatcher.ready(written.value.marker)
	for (const dispatchMarker of dispatchMarkers) runtime.services.dispatcher.ready(dispatchMarker)
	return { ok: true, value: result }
}

async function writeFinishAndAcceptSchedulerRequest(
	runtime: CoreRuntime,
	storage: Parameters<Parameters<typeof withTransaction>[1]>[0],
	input: Input,
	startedActionId: Id,
	outcome: 'processed' | 'stale-no-op',
): Promise<CoreResult<{ marker: string }, Exclude<Error, InvalidInputError>>> {
	const actionId = nextId(runtime.values, 'action')
	if (!actionId.ok) return actionId

	const performed = runtimeRecord(runtime.values)
	if (!performed.ok) return performed

	const action =
		outcome === 'processed'
			? processedDeliveryWorkDispatchAction({
					actionId: actionId.value,
					deliveryId: input.deliveryId,
					performed: performed.value,
					startedActionId,
					operation: input.operation,
				})
			: staleNoopDeliveryWorkDispatchAction({
					actionId: actionId.value,
					deliveryId: input.deliveryId,
					performed: performed.value,
					startedActionId,
					operation: input.operation,
				})
	const put = await createRecord('action', storage, action)
	if (!put.ok) return put

	const marker = await acceptDispatchRequest(runtime.services.dispatcher, {
		type: 'delivery-work-scheduler',
		deliveryId: input.deliveryId,
		coordinationClaims: [exclusiveDeliverySchedulerClaim(input.deliveryId)],
		reason: { type: 'delivery-work-requested' },
	})
	return marker.ok ? { ok: true, value: { marker: marker.value } } : marker
}

function deliveryWorkResult(result: DeliveryWorkHandlerSuccess): { value: Result; dispatchMarkers: string[] } {
	return { value: { processedCount: result.processedCount, failures: result.failures }, dispatchMarkers: result.dispatchMarkers ?? [] }
}

function operationsEqual(left: DeliveryWorkOperation | null, right: DeliveryWorkOperation): boolean {
	return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

function completed(processedCount = 0): Result {
	return { processedCount, failures: [] }
}

function invariant(message: string): CoreResult<never, Exclude<Error, InvalidInputError>> {
	return { ok: false, error: { type: 'invariant-violation', message } }
}
