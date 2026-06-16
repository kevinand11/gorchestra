import type { Action } from '../../../domain/action'
import type { DeliveryArtifact } from '../../../domain/artifact'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { InvariantViolationError } from '../../../errors'
import { sourceControlDeliveryBranchName } from '../../../providers/source-control/branches'
import type { SourceControlArtifactCreation, SourceControlCreateArtifactBranchInput } from '../../../providers/source-control/types'
import type { CoreRuntime } from '../../../runtime'
import { nextId, putRecord, runtimeRecord } from '../../../utils/command-storage'
import { withTransaction } from '../../../utils/storage'
import type { Result as CoreResult } from '../../../utils/types'
import { resolvedSchedulerHandlerContext, type ProviderBackedSchedulerPreflightClaim } from '../preflight'
import type { ResolvedDeliveryHandlerContext, RunDeliveryWorkHandlerResult } from '../types'
import { actionRecord, externalOperationEvidence } from './result'

export type DeliveryArtifactCreationInput = SourceControlCreateArtifactBranchInput & {
	deliveryId: string
}

function deliveryArtifactCreationInput(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext'>,
): CoreResult<DeliveryArtifactCreationInput, InvariantViolationError> {
	const deliveryBranch = sourceControlDeliveryBranchName(context.deliveryContext.delivery.id)
	if (!deliveryBranch.ok) return deliveryBranch

	return {
		ok: true,
		value: {
			deliveryId: context.deliveryContext.delivery.id,
			repository: context.deliveryContext.repository,
			sourceBranch: context.deliveryContext.delivery.target.targetBranch,
			artifactBranch: deliveryBranch.value,
		},
	}
}

export async function handleDeliveryNeedsArtifactCreation(
	runtime: CoreRuntime,
	preflight: ProviderBackedSchedulerPreflightClaim,
): Promise<RunDeliveryWorkHandlerResult> {
	const input = deliveryArtifactCreationInput(preflight)
	if (!input.ok) return input

	const creation = await runtime.providers.sourceControl.createArtifactBranch(input.value)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, async (tx) => {
		const context = resolvedSchedulerHandlerContext(runtime.services, tx, preflight.deliveryContext, preflight)
		return context.ok ? recordDeliveryArtifactCreationResult(context.value, preflight.state, input.value, creation.value) : context
	})
}

export async function recordDeliveryArtifactCreationResult(
	context: ResolvedDeliveryHandlerContext,
	_state: DeliveryWorkState,
	input: DeliveryArtifactCreationInput,
	creation: SourceControlArtifactCreation,
): Promise<RunDeliveryWorkHandlerResult> {
	return creation.type === 'passed'
		? writePassedDeliveryArtifactCreation(context, input.artifactBranch)
		: writeFailedDeliveryArtifactCreation(context, creation.summary)
}

async function writePassedDeliveryArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	deliveryBranch: string,
): Promise<RunDeliveryWorkHandlerResult> {
	const records = deliveryArtifactCreationRecords(context, deliveryBranch)
	return records.ok ? putDeliveryArtifactCreationRecords(context, records.value) : records
}

function deliveryArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	deliveryBranch: string,
): CoreResult<
	{ artifact: DeliveryArtifact; action: Action },
	RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const artifact = deliveryArtifactRecord(context, deliveryBranch)
	if (!artifact.ok) return artifact

	const action = actionRecord(context, {
		type: 'create-delivery-artifact',
		deliveryArtifactId: artifact.value.id,
	})
	return action.ok ? { ok: true, value: { artifact: artifact.value, action: action.value } } : action
}

async function putDeliveryArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	records: { artifact: DeliveryArtifact; action: Action },
): Promise<RunDeliveryWorkHandlerResult> {
	const artifactPut = await putRecord('delivery-artifact', context.tx.deliveryArtifacts, records.artifact.id, records.artifact)
	if (!artifactPut.ok) return artifactPut

	const actionPut = await putRecord('action', context.tx.actions, records.action.id, records.action)
	if (!actionPut.ok) return actionPut

	return { ok: true, value: { processedCount: 1, failures: [] } }
}

async function writeFailedDeliveryArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	summary: string,
): Promise<RunDeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-delivery-external-operation-failure',
		evidence: externalOperationEvidence(summary),
	})
	if (!action.ok) return action

	const actionPut = await putRecord('action', context.tx.actions, action.value.id, action.value)
	if (!actionPut.ok) return actionPut

	return {
		ok: true,
		value: {
			processedCount: 1,
			failures: [{ scope: { type: 'delivery' }, operation: 'create-artifact', summary }],
		},
	}
}

function deliveryArtifactRecord(
	context: ResolvedDeliveryHandlerContext,
	deliveryBranch: string,
): CoreResult<DeliveryArtifact, RunDeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.services, 'delivery-artifact')
	if (!id.ok) return id

	const created = runtimeRecord(context.services)
	if (!created.ok) return created

	return {
		ok: true,
		value: {
			id: id.value,
			deliveryId: context.deliveryContext.delivery.id,
			config: { type: 'source-control', deliveryBranch },
			created: created.value,
		},
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { buildDeliveryContext } = await import('../../../utils/delivery-context')
	const { createTestCoreServices, localStamp, seedDelivery, seedSelectableModel } = await import('../../../utils/test-helpers')

	describe('Delivery Artifact creation handler', () => {
		it('builds deterministic provider input from the Delivery target branch', async () => {
			const context = await handlerContext()

			expect(deliveryArtifactCreationInput(context)).toEqual({
				ok: true,
				value: {
					deliveryId: 'delivery-1',
					repository: context.deliveryContext.repository,
					sourceBranch: 'main',
					artifactBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ',
				},
			})
		})

		it('stores a Delivery Artifact and Action after provider success', async () => {
			const context = await handlerContext()
			const input = deliveryArtifactCreationInput(context)
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordDeliveryArtifactCreationResult(context, { type: 'needs-artifact-creation' }, input.value, {
				type: 'passed',
				mode: 'created',
				summary: 'created',
			})

			expect(result).toEqual({ ok: true, value: { processedCount: 1, failures: [] } })
			expect(context.tx.deliveryArtifacts.records.get('delivery-artifact-1')).toEqual({
				id: 'delivery-artifact-1',
				deliveryId: 'delivery-1',
				config: { type: 'source-control', deliveryBranch: 'gorchestra/deliveries/d-ZGVsaXZlcnktMQ' },
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'create-delivery-artifact',
				deliveryArtifactId: 'delivery-artifact-1',
			})
		})

		it('records external-operation failure evidence after provider failure', async () => {
			const context = await handlerContext()
			const input = deliveryArtifactCreationInput(context)
			if (!input.ok) throw new Error('Expected input.')

			const result = await recordDeliveryArtifactCreationResult(context, { type: 'needs-artifact-creation' }, input.value, {
				type: 'failed',
				reason: { type: 'source-branch-not-found', branch: 'main' },
				summary: 'GitHub artifact source branch was not found.',
			})

			expect(result).toEqual({
				ok: true,
				value: {
					processedCount: 1,
					failures: [
						{
							scope: { type: 'delivery' },
							operation: 'create-artifact',
							summary: 'GitHub artifact source branch was not found.',
						},
					],
				},
			})
			expect(context.tx.actions.records.get('action-1')?.result).toEqual({
				type: 'record-delivery-external-operation-failure',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-artifact' },
					passed: false,
					summary: 'GitHub artifact source branch was not found.',
				},
			})
		})
	})

	async function handlerContext() {
		const options = createTestCoreServices()
		seedDelivery(options.tx, 'delivery-1')
		seedSelectableModel(options.tx, 'model-1')
		options.tx.deliveries.records.get('delivery-1')!.queued = localStamp()

		const deliveryContext = await buildDeliveryContext(options.tx, 'delivery-1')
		if (!deliveryContext.ok) throw new Error('Expected Delivery Context.')

		return {
			services: options,
			tx: options.tx,
			deliveryContext: deliveryContext.value,
			workResolution: {
				workConfig: { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 },
				executionModel: options.tx.models.records.get('model-1')!,
				executionModelProvider: options.tx.modelProviders.records.get('model-1-provider')!,
			},
		}
	}
}
