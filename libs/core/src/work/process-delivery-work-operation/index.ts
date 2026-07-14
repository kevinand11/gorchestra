import { v, type PipeOutput } from 'valleyed'

import { deliveryWorkOperationPipe, type Action, type DeliveryWorkOperation } from '../../domain/action'
import { idPipe, type Id } from '../../domain/commons'
import type { ValidationEvidence } from '../../domain/evidence'
import type { InvalidInputError } from '../../errors'
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
import { exclusiveDeliverySchedulerClaim } from '../../dispatch/claims'
import { buildDeliveryContext, getDeliveryState, getSliceState, type DeliveryContext } from '../../utils/delivery-context'
import {
	deliveryPreflightChecksPassed,
	providerBackedDeliveryWorkResolution,
	providerBackedRepositoryAccessSecret,
	readProviderBackedDeliveryPreflightPlan,
	runProviderBackedDeliveryPreflightChecks,
} from '../../utils/delivery-preflight'
import { nextId, runtimeRecord } from '../../utils/runtime-values'
import { createRecord } from '../../utils/storage/helpers'
import type { Result as CoreResult } from '../../utils/types'
import { buildWorkHandler } from '../../utils/work-handler'
import { deliveryOperationFromState, sliceOperationFromState } from '../delivery-work/dispatch-actions'
import type { DeliveryWorkHandlerResult, Error, ResolvedDeliveryHandlerContext, Result } from '../delivery-work/types'

const processDeliveryWorkOperationInputPipe = v.object({
	deliveryId: idPipe,
	requestId: idPipe,
	attemptNumber: v.number().pipe(v.int(), v.gte(1)),
	operationId: idPipe,
	operation: deliveryWorkOperationPipe,
})
type RawInput = PipeOutput<typeof processDeliveryWorkOperationInputPipe>
export type Input = Omit<RawInput, 'operation'> & { operation: DeliveryWorkOperation }
export type Operation = (input: Input, context: WorkContext) => Promise<CoreResult<Result, Error>>

export function createProcessDeliveryWorkOperation(runtime: CoreRuntime): Operation {
	return buildWorkHandler('processDeliveryWorkOperation', processDeliveryWorkOperationInputPipe, async (parsedInput, context) => {
		const input = parsedInput as Input
		if (context.signal?.aborted === true) {
			return {
				ok: false,
				error: { type: 'dispatch-attempt-aborted', requestId: input.requestId, attemptNumber: input.attemptNumber },
			}
		}
		const current = await runtime.transactions.run(async ({ storage }) => {
			const deliveryContext = await buildDeliveryContext(storage, input.deliveryId)
			if (!deliveryContext.ok) return deliveryContext

			const filteredContext = {
				...deliveryContext.value,
				dispatchRequests: deliveryContext.value.dispatchRequests.filter((request) => request.id !== input.requestId),
			}
			const operation = currentOperation(filteredContext, input.operation)
			return operation.ok ? { ok: true, value: { deliveryContext: filteredContext, operation: operation.value } } : operation
		})
		if (!current.ok) return current
		if (!operationsEqual(current.value.operation, input.operation)) {
			const scheduled = await requestNextScheduler(runtime, input.deliveryId)
			return scheduled.ok ? { ok: true, value: completed() } : scheduled
		}

		const preflight = await runProcessorPreflight(runtime, current.value.deliveryContext)
		if (!preflight.ok) return preflight
		if (!deliveryPreflightChecksPassed(preflight.value.checks)) {
			return writeFailedPreflightAndRequestScheduler(runtime, input, preflight.value.checks)
		}

		const handled = await processFreshOperation(runtime, input, preflight.value.context)
		if (!handled.ok) return handled
		if (input.operation.scope === 'slice' && input.operation.state === 'executable') return handled

		const scheduled = await requestNextScheduler(runtime, input.deliveryId)
		return scheduled.ok ? handled : scheduled
	})
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
	context: ResolvedDeliveryHandlerContext,
): Promise<DeliveryWorkHandlerResult> {
	const operationContext = {
		...context,
		dispatch: { requestId: input.requestId, attemptNumber: input.attemptNumber },
		operationId: input.operationId,
	}
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

async function writeFailedPreflightAndRequestScheduler(
	runtime: CoreRuntime,
	input: Input,
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

		const accepted = await dispatch.request({
			payload: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
			coordinationClaims: [exclusiveDeliverySchedulerClaim(input.deliveryId)],
			deduplicationKey: { type: 'delivery-work-scheduler', deliveryId: input.deliveryId },
			reason: { type: 'delivery-work-requested' },
		})
		return accepted.ok ? { ok: true, value: completed(1) } : accepted
	})
}

function requestNextScheduler(runtime: CoreRuntime, deliveryId: Id): Promise<CoreResult<void, Exclude<Error, InvalidInputError>>> {
	return runtime.transactions.run(async ({ dispatch }) => {
		const accepted = await dispatch.request({
			payload: { type: 'delivery-work-scheduler', deliveryId },
			coordinationClaims: [exclusiveDeliverySchedulerClaim(deliveryId)],
			deduplicationKey: { type: 'delivery-work-scheduler', deliveryId },
			reason: { type: 'delivery-work-requested' },
		})
		return accepted.ok ? { ok: true, value: undefined } : accepted
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
