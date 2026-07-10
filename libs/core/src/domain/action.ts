import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, runtimeRecordPipe } from './commons'
import { externalOperationEvidencePipe, validationEvidencePipe } from './evidence'
import { coreSchema, schemaToPipe } from '../utils/storage/schema'

const deliveryWorkOperationDeliveryStatePipe = v.in(['needs-artifact-creation', 'needs-artifact-validation', 'needs-review-surface'])
const deliveryWorkOperationSliceStatePipe = v.in([
	'needs-delivery-validation',
	'needs-artifact-validation',
	'needs-review-surface',
	'needs-artifact-creation',
	'executable',
])

export const deliveryWorkOperationPipe = v.discriminate((value) => value.scope, {
	delivery: v.object({
		scope: v.eq('delivery'),
		state: deliveryWorkOperationDeliveryStatePipe,
	}),
	slice: v.object({
		scope: v.eq('slice'),
		sliceId: idPipe,
		state: deliveryWorkOperationSliceStatePipe,
		detail: v.nullable(
			v.discriminate((value) => value.type, {
				action: v.object({ type: v.eq('action'), actionId: idPipe }),
				artifact: v.object({ type: v.eq('artifact'), artifactId: idPipe }),
				'correction-root': v.object({ type: v.eq('correction-root'), actionId: idPipe }),
			}),
		),
	}),
})
export type DeliveryWorkOperation = PipeOutput<typeof deliveryWorkOperationPipe>

export const actionResultPipe = v.discriminate((value) => value.type, {
	'validate-preflight': v.object({ type: v.eq('validate-preflight'), checks: v.array(validationEvidencePipe) }),
	'queue-delivery-work-operation': v.object({
		type: v.eq('queue-delivery-work-operation'),
		operation: deliveryWorkOperationPipe,
	}),
	'start-delivery-work-operation': v.object({
		type: v.eq('start-delivery-work-operation'),
		queuedActionId: idPipe,
		operation: deliveryWorkOperationPipe,
	}),
	'finish-delivery-work-operation': v.object({
		type: v.eq('finish-delivery-work-operation'),
		startedActionId: idPipe,
		operation: deliveryWorkOperationPipe,
		outcome: v.discriminate((value) => value.type, {
			processed: v.object({ type: v.eq('processed') }),
			'stale-no-op': v.object({ type: v.eq('stale-no-op') }),
		}),
	}),
	'create-delivery-artifact': v.object({
		type: v.eq('create-delivery-artifact'),
		deliveryArtifactId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'create-slice-artifact': v.object({
		type: v.eq('create-slice-artifact'),
		sliceId: idPipe,
		sliceArtifactId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'start-revision-planning': v.object({ type: v.eq('start-revision-planning'), revisionGateId: idPipe, agentRunId: idPipe }),
	'validate-slice-artifact': v.object({
		type: v.eq('validate-slice-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'create-slice-review-surface': v.object({
		type: v.eq('create-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'observe-slice-review-surface': v.object({
		type: v.eq('observe-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'promote-slice-artifact': v.object({
		type: v.eq('promote-slice-artifact'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'validate-slice-delivery-artifact': v.object({
		type: v.eq('validate-slice-delivery-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'validate-delivery-artifact': v.object({
		type: v.eq('validate-delivery-artifact'),
		evidence: validationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'observe-delivery-artifact-integration': v.object({
		type: v.eq('observe-delivery-artifact-integration'),
		evidence: externalOperationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'create-delivery-review-surface': v.object({
		type: v.eq('create-delivery-review-surface'),
		reviewSurfaceId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'observe-delivery-review-surface': v.object({
		type: v.eq('observe-delivery-review-surface'),
		reviewSurfaceId: idPipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'start-revision-execution': v.object({ type: v.eq('start-revision-execution'), revisionId: idPipe, agentRunId: idPipe }),
	'record-slice-external-operation-failure': v.object({
		type: v.eq('record-slice-external-operation-failure'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
	}),
	'record-revision-external-operation-failure': v.object({
		type: v.eq('record-revision-external-operation-failure'),
		revisionId: idPipe,
		evidence: externalOperationEvidencePipe,
	}),
	'record-delivery-external-operation-failure': v.object({
		type: v.eq('record-delivery-external-operation-failure'),
		evidence: externalOperationEvidencePipe,
		dispatchStartedActionId: v.nullable(idPipe),
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
