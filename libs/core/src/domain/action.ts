import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, runtimeRecordPipe } from './commons'
import { deliveryIntegrationPipe } from './delivery'
import { externalOperationEvidencePipe, validationEvidencePipe } from './evidence'

export const actionResultPipe = v.discriminate((value) => value.type, {
	'queue-delivery': v.object({ type: v.eq('queue-delivery') }),
	'ship-delivery': v.object({ type: v.eq('ship-delivery'), integration: deliveryIntegrationPipe }),
	'abandon-delivery': v.object({
		type: v.eq('abandon-delivery'),
		reason: v.string(),
		cleanupEvidence: v.array(externalOperationEvidencePipe),
	}),
	'validate-preflight': v.object({ type: v.eq('validate-preflight'), checks: v.array(validationEvidencePipe) }),
	'create-delivery-artifact': v.object({ type: v.eq('create-delivery-artifact'), deliveryArtifactId: idPipe }),
	'create-slice-artifact': v.object({ type: v.eq('create-slice-artifact'), sliceId: idPipe, sliceArtifactId: idPipe }),
	'start-revision-planning': v.object({ type: v.eq('start-revision-planning'), revisionGateId: idPipe, agentRunId: idPipe }),
	'validate-slice-artifact': v.object({ type: v.eq('validate-slice-artifact'), sliceId: idPipe, evidence: validationEvidencePipe }),
	'create-slice-review-surface': v.object({ type: v.eq('create-slice-review-surface'), sliceId: idPipe, reviewSurfaceId: idPipe }),
	'observe-slice-review-surface': v.object({ type: v.eq('observe-slice-review-surface'), sliceId: idPipe, reviewSurfaceId: idPipe }),
	'promote-slice-artifact': v.object({ type: v.eq('promote-slice-artifact'), sliceId: idPipe, evidence: externalOperationEvidencePipe }),
	'validate-slice-delivery-artifact': v.object({
		type: v.eq('validate-slice-delivery-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
	}),
	'validate-delivery-artifact': v.object({ type: v.eq('validate-delivery-artifact'), evidence: validationEvidencePipe }),
	'observe-delivery-artifact-integration': v.object({
		type: v.eq('observe-delivery-artifact-integration'),
		evidence: externalOperationEvidencePipe,
	}),
	'create-delivery-review-surface': v.object({ type: v.eq('create-delivery-review-surface'), reviewSurfaceId: idPipe }),
	'observe-delivery-review-surface': v.object({ type: v.eq('observe-delivery-review-surface'), reviewSurfaceId: idPipe }),
	'start-revision-execution': v.object({ type: v.eq('start-revision-execution'), revisionId: idPipe, agentRunId: idPipe }),
	'record-slice-external-operation-failure': v.object({
		type: v.eq('record-slice-external-operation-failure'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
	}),
	'record-revision-external-operation-failure': v.object({
		type: v.eq('record-revision-external-operation-failure'),
		revisionId: idPipe,
		evidence: externalOperationEvidencePipe,
	}),
	'record-delivery-external-operation-failure': v.object({
		type: v.eq('record-delivery-external-operation-failure'),
		evidence: externalOperationEvidencePipe,
	}),
})
export type ActionResult = PipeOutput<typeof actionResultPipe>

export const actionPipe = v.object({
	id: idPipe,
	deliveryId: idPipe,
	performed: runtimeRecordPipe,
	authorized: v.nullable(auditStampPipe),
	result: actionResultPipe,
})
export type Action = PipeOutput<typeof actionPipe>
