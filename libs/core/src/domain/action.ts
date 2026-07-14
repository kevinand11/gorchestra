import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, positiveIntegerPipe, runtimeRecordPipe } from './commons'
import { dispatchRequestTypePipe, safeDispatchCategoryPipe, safeDispatchSummaryPipe } from './dispatch-request'
import { externalOperationEvidencePipe, validationEvidencePipe } from './evidence'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

export { deliveryWorkOperationPipe, type DeliveryWorkOperation } from './delivery-work-operation'

export const deliveryWorkDispatchRefPipe = v.object({ requestId: idPipe, attemptNumber: positiveIntegerPipe })
export type DeliveryWorkDispatchRef = PipeOutput<typeof deliveryWorkDispatchRefPipe>

export const actionResultPipe = v.discriminate((value) => value.type, {
	'record-delivery-work-dispatch-failure': v.object({
		type: v.eq('record-delivery-work-dispatch-failure'),
		scope: v.discriminate((value) => value.type, {
			delivery: v.object({ type: v.eq('delivery') }),
			slice: v.object({ type: v.eq('slice'), sliceId: idPipe }),
		}),
		requestId: idPipe,
		requestType: dispatchRequestTypePipe,
		attemptNumber: positiveIntegerPipe,
		category: safeDispatchCategoryPipe,
		summary: safeDispatchSummaryPipe,
	}),
	'validate-preflight': v.object({ type: v.eq('validate-preflight'), checks: v.array(validationEvidencePipe) }),
	'create-delivery-artifact': v.object({
		type: v.eq('create-delivery-artifact'),
		deliveryArtifactId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'create-slice-artifact': v.object({
		type: v.eq('create-slice-artifact'),
		sliceId: idPipe,
		sliceArtifactId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'start-revision-planning': v.object({ type: v.eq('start-revision-planning'), revisionGateId: idPipe, agentRunId: idPipe }),
	'validate-slice-artifact': v.object({
		type: v.eq('validate-slice-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'create-slice-review-surface': v.object({
		type: v.eq('create-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'observe-slice-review-surface': v.object({
		type: v.eq('observe-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'promote-slice-artifact': v.object({
		type: v.eq('promote-slice-artifact'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'validate-slice-delivery-artifact': v.object({
		type: v.eq('validate-slice-delivery-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'validate-delivery-artifact': v.object({
		type: v.eq('validate-delivery-artifact'),
		evidence: validationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'observe-delivery-artifact-integration': v.object({
		type: v.eq('observe-delivery-artifact-integration'),
		evidence: externalOperationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'create-delivery-review-surface': v.object({
		type: v.eq('create-delivery-review-surface'),
		reviewSurfaceId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'observe-delivery-review-surface': v.object({
		type: v.eq('observe-delivery-review-surface'),
		reviewSurfaceId: idPipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'start-revision-execution': v.object({ type: v.eq('start-revision-execution'), revisionId: idPipe, agentRunId: idPipe }),
	'record-slice-external-operation-failure': v.object({
		type: v.eq('record-slice-external-operation-failure'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
	'record-revision-external-operation-failure': v.object({
		type: v.eq('record-revision-external-operation-failure'),
		revisionId: idPipe,
		evidence: externalOperationEvidencePipe,
	}),
	'record-delivery-external-operation-failure': v.object({
		type: v.eq('record-delivery-external-operation-failure'),
		evidence: externalOperationEvidencePipe,
		dispatch: v.nullable(deliveryWorkDispatchRefPipe),
	}),
})
export type ActionResult = PipeOutput<typeof actionResultPipe>

export const actionSchema = coreSchema('actions')
	.field('deliveryId', idPipe)
	.field('performed', runtimeRecordPipe)
	.field('authorized', v.nullable(auditStampPipe))
	.field('result', actionResultPipe)
	.build()
export const actionPipe = schemaToPipe(actionSchema)
export type Action = PipeOutput<typeof actionPipe>
