import { actionRecord, externalOperationEvidence } from './result'
import type { Action } from '../../../domain/action'
import type { DeliveryArtifact } from '../../../domain/artifact'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { InvariantViolationError } from '../../../errors'
import { sourceControlDeliveryBranchName } from '../../../providers/source-control/branches'
import type { SourceControlArtifactCreation, SourceControlCreateArtifactBranchInput } from '../../../providers/source-control/types'
import type { CoreRuntime } from '../../../runtime'
import { createRecord, withTransaction } from '../../../storage/helpers'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import type { Result as CoreResult } from '../../../utils/types'
import type { DeliveryWorkHandlerResult, ResolvedDeliveryHandlerContext } from '../../delivery-work/types'

export type DeliveryArtifactCreationInput = SourceControlCreateArtifactBranchInput & {
	deliveryId: string
}

function deliveryArtifactCreationInput(
	context: Pick<ResolvedDeliveryHandlerContext, 'deliveryContext' | 'repositoryAccessSecret'>,
): CoreResult<DeliveryArtifactCreationInput, InvariantViolationError> {
	const deliveryBranch = sourceControlDeliveryBranchName(context.deliveryContext.delivery.id)
	if (!deliveryBranch.ok) return deliveryBranch

	return {
		ok: true,
		value: {
			deliveryId: context.deliveryContext.delivery.id,
			repository: context.deliveryContext.repository,
			accessSecret: context.repositoryAccessSecret,
			sourceBranch: context.deliveryContext.delivery.target.targetBranch,
			artifactBranch: deliveryBranch.value,
		},
	}
}

export async function handleDeliveryNeedsArtifactCreation(
	runtime: CoreRuntime,
	context: ResolvedDeliveryHandlerContext,
	state: Extract<DeliveryWorkState, { type: 'needs-artifact-creation' }>,
): Promise<DeliveryWorkHandlerResult> {
	const input = deliveryArtifactCreationInput(context)
	if (!input.ok) return input

	const creation = await runtime.providers.sourceControl.createArtifactBranch(input.value)
	if (!creation.ok) return creation

	return withTransaction(runtime.services, (storage) =>
		recordDeliveryArtifactCreationResult({ ...context, storage }, state, input.value, creation.value),
	)
}

export async function recordDeliveryArtifactCreationResult(
	context: ResolvedDeliveryHandlerContext,
	_state: DeliveryWorkState,
	input: DeliveryArtifactCreationInput,
	creation: SourceControlArtifactCreation,
): Promise<DeliveryWorkHandlerResult> {
	return creation.type === 'passed'
		? writePassedDeliveryArtifactCreation(context, input.artifactBranch)
		: writeFailedDeliveryArtifactCreation(context, creation.summary)
}

async function writePassedDeliveryArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	deliveryBranch: string,
): Promise<DeliveryWorkHandlerResult> {
	const records = deliveryArtifactCreationRecords(context, deliveryBranch)
	return records.ok ? putDeliveryArtifactCreationRecords(context, records.value) : records
}

function deliveryArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	deliveryBranch: string,
): CoreResult<
	{ artifact: DeliveryArtifact; action: Action },
	DeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never
> {
	const artifact = deliveryArtifactRecord(context, deliveryBranch)
	if (!artifact.ok) return artifact

	const action = actionRecord(context, {
		type: 'create-delivery-artifact',
		deliveryArtifactId: artifact.value.id,
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
	return action.ok ? { ok: true, value: { artifact: artifact.value, action: action.value } } : action
}

async function putDeliveryArtifactCreationRecords(
	context: ResolvedDeliveryHandlerContext,
	records: { artifact: DeliveryArtifact; action: Action },
): Promise<DeliveryWorkHandlerResult> {
	const artifactPut = await createRecord('delivery-artifact', context.storage, records.artifact)
	if (!artifactPut.ok) return artifactPut

	const actionPut = await createRecord('action', context.storage, records.action)
	if (!actionPut.ok) return actionPut

	return { ok: true, value: { processedCount: 1, failures: [] } }
}

async function writeFailedDeliveryArtifactCreation(
	context: ResolvedDeliveryHandlerContext,
	summary: string,
): Promise<DeliveryWorkHandlerResult> {
	const action = actionRecord(context, {
		type: 'record-delivery-external-operation-failure',
		evidence: externalOperationEvidence(summary),
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
	if (!action.ok) return action

	const actionPut = await createRecord('action', context.storage, action.value)
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
): CoreResult<DeliveryArtifact, DeliveryWorkHandlerResult extends CoreResult<unknown, infer TError> ? TError : never> {
	const id = nextId(context.values, 'delivery-artifact')
	if (!id.ok) return id

	const created = runtimeRecord(context.values)
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
	const { createDeliveryWorkHandlerTestContext } = await import('./test-utils')

	describe('Delivery Artifact creation handler', () => {
		it('builds deterministic provider input from the Delivery target branch', async () => {
			const context = await handlerContext()

			expect(deliveryArtifactCreationInput(context)).toEqual({
				ok: true,
				value: {
					deliveryId: 'delivery-1',
					repository: context.deliveryContext.repository,
					accessSecret: context.repositoryAccessSecret,
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
		return createDeliveryWorkHandlerTestContext()
	}
}
