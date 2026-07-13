import { actionRecord, externalOperationEvidence } from './result'
import type { DeliveryWorkState } from '../../../domain/delivery'
import type { DeliveryArtifact } from '../../../domain/delivery-artifact'
import type { InvariantViolationError } from '../../../errors'
import { sourceControlDeliveryBranchName } from '../../../utils/providers/source-control/branches'
import type { SourceControlArtifactCreation, SourceControlCreateArtifactBranchInput } from '../../../utils/providers/source-control/types'
import type { CoreRuntime } from '../../../utils/runtime'
import { nextId, runtimeRecord } from '../../../utils/runtime-values'
import { createRecord } from '../../../utils/storage/helpers'
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

	return runtime.transactions.run(({ storage }) =>
		recordDeliveryArtifactCreationResult({ ...context, storage }, state, input.value, creation.value),
	)
}

async function recordDeliveryArtifactCreationResult(
	context: ResolvedDeliveryHandlerContext,
	_state: DeliveryWorkState,
	input: DeliveryArtifactCreationInput,
	creation: SourceControlArtifactCreation,
): Promise<DeliveryWorkHandlerResult> {
	if (creation.type === 'failed') {
		const action = actionRecord(context, {
			type: 'record-delivery-external-operation-failure',
			evidence: externalOperationEvidence(creation.summary),
			dispatchStartedActionId: context.dispatchStartedActionId ?? null,
		})
		if (!action.ok) return action

		const actionPut = await createRecord('action', context.storage, action.value)
		return actionPut.ok
			? {
					ok: true,
					value: {
						processedCount: 1,
						failures: [{ scope: { type: 'delivery' }, operation: 'create-artifact', summary: creation.summary }],
					},
				}
			: actionPut
	}

	const artifactId = nextId(context.values)
	if (!artifactId.ok) return artifactId
	const created = runtimeRecord(context.values)
	if (!created.ok) return created

	const artifact: DeliveryArtifact = {
		id: artifactId.value,
		deliveryId: context.deliveryContext.delivery.id,
		config: { type: 'source-control', deliveryBranch: input.artifactBranch },
		created: created.value,
	}
	const action = actionRecord(context, {
		type: 'create-delivery-artifact',
		deliveryArtifactId: artifact.id,
		dispatchStartedActionId: context.dispatchStartedActionId ?? null,
	})
	if (!action.ok) return action

	const artifactPut = await createRecord('delivery-artifact', context.storage, artifact)
	if (!artifactPut.ok) return artifactPut
	const actionPut = await createRecord('action', context.storage, action.value)
	return actionPut.ok ? { ok: true, value: { processedCount: 1, failures: [] } } : actionPut
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
					deliveryId: '01k00000000000000000000008',
					repository: context.deliveryContext.repository,
					accessSecret: context.repositoryAccessSecret,
					sourceBranch: 'main',
					artifactBranch: 'gorchestra/deliveries/d-MDFrMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDg',
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
			expect(context.tx.deliveryArtifacts.records.get('01k00000000000000000010001')).toEqual({
				id: '01k00000000000000000010001',
				deliveryId: '01k00000000000000000000008',
				config: { type: 'source-control', deliveryBranch: 'gorchestra/deliveries/d-MDFrMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDg' },
				created: { at: '2026-06-10T12:00:00.000Z' },
			})
			expect(context.tx.actions.records.get('01k00000000000000000010002')?.result).toEqual({
				type: 'create-delivery-artifact',
				deliveryArtifactId: '01k00000000000000000010001',
				dispatchStartedActionId: null,
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
			expect(context.tx.actions.records.get('01k00000000000000000010001')?.result).toEqual({
				type: 'record-delivery-external-operation-failure',
				evidence: {
					type: 'external-operation',
					operation: { type: 'create-artifact' },
					passed: false,
					summary: 'GitHub artifact source branch was not found.',
				},
				dispatchStartedActionId: null,
			})
		})
	})

	async function handlerContext() {
		return createDeliveryWorkHandlerTestContext()
	}
}
