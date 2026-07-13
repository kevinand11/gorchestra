import { v, type PipeOutput } from 'valleyed'

import { deliveryWorkOperationPipe, type Action, type DeliveryWorkOperation } from '../../domain/action'
import { idPipe, type Id } from '../../domain/commons'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
import type { CoreStorage } from '../../services'
import type { CoreRuntime } from '../../utils/runtime'
import type { WorkContext } from '../types'
import { handleDeliveryNeedsArtifactCreation } from './handlers/delivery-needs-artifact-creation'
import { handleDeliveryNeedsArtifactValidation } from './handlers/delivery-needs-artifact-validation'
import { handleDeliveryNeedsReviewSurface } from './handlers/delivery-needs-review-surface'
import { handleSliceExecutable } from './handlers/slice-executable'
import { handleSliceNeedsArtifactCreation } from './handlers/slice-needs-artifact-creation'
import { handleSliceNeedsArtifactValidation } from './handlers/slice-needs-artifact-validation'
import { handleSliceNeedsDeliveryValidation } from './handlers/slice-needs-delivery-validation'
import { handleSliceNeedsReviewSurface } from './handlers/slice-needs-review-surface'
import { buildDeliveryContext, getDeliveryState, getSliceState, type DeliveryContext } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryWorkResolution,
	providerBackedRepositoryAccessSecret,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
} from '../../utils/delivery-preflight'
import { exclusiveDeliverySchedulerClaim } from '../../utils/dispatch'
import { nextId, runtimeRecord } from '../../utils/runtime-values'
import { createRecord, getRequired, listRecords } from '../../utils/storage/helpers'
import type { CoreTransactionDispatch } from '../../utils/transactions'
import type { Result as CoreResult } from '../../utils/types'
import { buildWorkHandler } from '../../utils/work-handler'
import {
	deliveryOperationFromState,
	processedDeliveryWorkDispatchAction,
	staleNoopDeliveryWorkDispatchAction,
	startedDeliveryWorkDispatchAction,
	sliceOperationFromState,
} from '../delivery-work/dispatch-actions'
import type { DeliveryWorkHandlerResult, Error, ResolvedDeliveryHandlerContext, Result } from '../delivery-work/types'

const processDeliveryWorkOperationInputPipe = v.object({
	deliveryId: idPipe,
	queuedActionId: idPipe,
	operation: deliveryWorkOperationPipe,
})
type RawInput = PipeOutput<typeof processDeliveryWorkOperationInputPipe>
export type Input = Omit<RawInput, 'operation'> & { operation: DeliveryWorkOperation }
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createProcessDeliveryWorkOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('processDeliveryWorkOperation', processDeliveryWorkOperationInputPipe, async (parsedInput) => {
		const input = parsedInput as Input
		const started = await runtime.transactions.run(({ storage }) => recordStartedDispatchAction(runtime, storage, input))
		if (!started.ok) return started
		if (started.value.type === 'already-started') return { ok: true, value: completed() }

		const startedActionId = started.value.action.id
		const current = await runtime.transactions.run(async ({ storage }) => {
			const deliveryContext = await buildDeliveryContext(storage, input.deliveryId)
			if (!deliveryContext.ok) return deliveryContext

			const filteredContext = {
				...deliveryContext.value,
				actions: deliveryContext.value.actions.filter(
					(action) => !isOwnDispatchAction(action, input.queuedActionId, startedActionId),
				),
			}
			const operation = currentOperation(filteredContext, input.operation)
			return operation.ok ? { ok: true, value: { deliveryContext: filteredContext, operation: operation.value } } : operation
		})
		if (!current.ok) return current
		if (!operationsEqual(current.value.operation, input.operation)) {
			return finishAndRequestScheduler(runtime, input, startedActionId, 'stale-no-op', completed(1))
		}

		const preflight = await runProcessorPreflight(runtime, current.value.deliveryContext)
		if (!preflight.ok) return preflight
		if (!deliveryPreflightChecksPassed(preflight.value.checks)) {
			return writeFailedPreflightFinishAndRequestScheduler(runtime, input, startedActionId, preflight.value.checks)
		}

		const handled = await processFreshOperation(runtime, input, startedActionId, preflight.value.context)
		if (!handled.ok) return handled

		return finishAndRequestScheduler(runtime, input, startedActionId, 'processed', handled.value)
	})
}

type StartedAttempt = { type: 'started'; action: Action } | { type: 'already-started' }

async function recordStartedDispatchAction(
	runtime: CoreRuntime,
	storage: CoreStorage,
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

	const actions = await listRecords('action', storage, {
		where: (filter, fields) => filter.eq(fields.deliveryId, input.deliveryId),
	})
	if (!actions.ok) return actions
	const existingStarted = actions.value.find(
		(action) => action.result.type === 'start-delivery-work-operation' && action.result.queuedActionId === input.queuedActionId,
	)
	if (existingStarted !== undefined) return { ok: true, value: { type: 'already-started' } }

	const actionId = nextId(runtime.values)
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
	const plan = await runtime.transactions.run(({ storage }) => readProviderBackedDeliveryPreflightPlan(storage, deliveryContext))
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
					context: {
						services: runtime.services,
						storage: runtime.services.storage,
						values: runtime.values,
						deliveryContext,
					} as ResolvedDeliveryHandlerContext,
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

async function processFreshOperation(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
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
			return runtime.transactions.run(async ({ storage }) =>
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
			return runtime.transactions.run(async ({ storage }) =>
				handleSliceNeedsDeliveryValidation({ ...context, storage }, deliverySlice.slice, {
					type: 'needs-delivery-validation',
					actionId: operation.detail?.type === 'action' ? operation.detail.actionId : '',
				}),
			)
		case 'needs-artifact-validation': {
			const sliceArtifactId = operation.detail?.type === 'artifact' ? operation.detail.artifactId : deliverySlice.artifact?.id
			return sliceArtifactId === undefined
				? invariant(`Slice ${operation.sliceId} Artifact is missing from Delivery Context.`)
				: runtime.transactions.run(async ({ storage }) =>
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
			return runtime.transactions.run((transaction) =>
				handleSliceExecutable(
					{ ...context, storage: transaction.storage },
					deliverySlice.slice,
					operation.detail?.type === 'correction-root'
						? {
								type: 'executable',
								mode: 'correction',
								failureChain: { rootActionId: operation.detail.actionId, correctionRetries: 0 },
							}
						: { type: 'executable', mode: 'initial' },
					context.workResolution,
					transaction,
				),
			)
		default:
			throw new Error(`Unexpected Slice Work Operation state: ${String(operation.state satisfies never)}`)
	}
}

async function writeFailedPreflightFinishAndRequestScheduler(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
	checks: ValidationEvidence[],
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return runtime.transactions.run(async ({ storage, dispatch }) => {
		const preflightId = nextId(runtime.values)
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

		const finished = await writeFinishAndRequestScheduler(runtime, storage, dispatch, input, startedActionId, 'processed')
		return finished.ok ? { ok: true, value: completed(1) } : finished
	})
}

function finishAndRequestScheduler(
	runtime: CoreRuntime,
	input: Input,
	startedActionId: Id,
	outcome: 'processed' | 'stale-no-op',
	result: Result,
): Promise<CoreResult<Result, Exclude<Error, InvalidInputError>>> {
	return runtime.transactions.run(async ({ storage, dispatch }) => {
		const finished = await writeFinishAndRequestScheduler(runtime, storage, dispatch, input, startedActionId, outcome)
		return finished.ok ? { ok: true, value: result } : finished
	})
}

async function writeFinishAndRequestScheduler(
	runtime: CoreRuntime,
	storage: CoreStorage,
	dispatch: CoreTransactionDispatch,
	input: Input,
	startedActionId: Id,
	outcome: 'processed' | 'stale-no-op',
): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	const actionId = nextId(runtime.values)
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

	return dispatch.request({
		type: 'delivery-work-scheduler',
		deliveryId: input.deliveryId,
		coordinationClaims: [exclusiveDeliverySchedulerClaim(input.deliveryId)],
		reason: { type: 'delivery-work-requested' },
	})
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
