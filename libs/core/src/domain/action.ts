import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, runtimeRecordPipe } from './commons'
import { externalOperationEvidencePipe, validationEvidencePipe } from './evidence'

const deliveryWorkOperationDeliveryStatePipe = v.in([
	'needs-artifact-creation',
	'needs-artifact-validation',
	'needs-review-surface',
	'awaiting-review',
])
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
		detail: v.optional(
			v.discriminate((value) => value.type, {
				action: v.object({ type: v.eq('action'), actionId: idPipe }),
				artifact: v.object({ type: v.eq('artifact'), artifactId: idPipe }),
				'correction-root': v.object({ type: v.eq('correction-root'), actionId: idPipe }),
			}),
		),
	}),
})
type OptionalUndefinedProperties<T> =
	T extends Array<infer Item>
		? Array<OptionalUndefinedProperties<Item>>
		: T extends object
			? {
					[Key in keyof T as undefined extends T[Key] ? never : Key]: OptionalUndefinedProperties<T[Key]>
				} & {
					[Key in keyof T as undefined extends T[Key] ? Key : never]?: OptionalUndefinedProperties<Exclude<T[Key], undefined>>
				}
			: T

export type DeliveryWorkOperation = OptionalUndefinedProperties<PipeOutput<typeof deliveryWorkOperationPipe>>

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
		outcome: v.object({ type: v.eq('stale-no-op') }),
	}),
	'create-delivery-artifact': v.object({
		type: v.eq('create-delivery-artifact'),
		deliveryArtifactId: idPipe,
	}),
	'create-slice-artifact': v.object({
		type: v.eq('create-slice-artifact'),
		sliceId: idPipe,
		sliceArtifactId: idPipe,
	}),
	'start-revision-planning': v.object({ type: v.eq('start-revision-planning'), revisionGateId: idPipe, agentRunId: idPipe }),
	'validate-slice-artifact': v.object({
		type: v.eq('validate-slice-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
	}),
	'create-slice-review-surface': v.object({
		type: v.eq('create-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
	}),
	'observe-slice-review-surface': v.object({
		type: v.eq('observe-slice-review-surface'),
		sliceId: idPipe,
		reviewSurfaceId: idPipe,
	}),
	'promote-slice-artifact': v.object({
		type: v.eq('promote-slice-artifact'),
		sliceId: idPipe,
		evidence: externalOperationEvidencePipe,
	}),
	'validate-slice-delivery-artifact': v.object({
		type: v.eq('validate-slice-delivery-artifact'),
		sliceId: idPipe,
		evidence: validationEvidencePipe,
	}),
	'validate-delivery-artifact': v.object({
		type: v.eq('validate-delivery-artifact'),
		evidence: validationEvidencePipe,
	}),
	'observe-delivery-artifact-integration': v.object({
		type: v.eq('observe-delivery-artifact-integration'),
		evidence: externalOperationEvidencePipe,
	}),
	'create-delivery-review-surface': v.object({
		type: v.eq('create-delivery-review-surface'),
		reviewSurfaceId: idPipe,
	}),
	'observe-delivery-review-surface': v.object({
		type: v.eq('observe-delivery-review-surface'),
		reviewSurfaceId: idPipe,
	}),
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
export type ActionResult = OptionalUndefinedProperties<PipeOutput<typeof actionResultPipe>>

export const actionPipe = v.object({
	id: idPipe,
	deliveryId: idPipe,
	performed: runtimeRecordPipe,
	authorized: v.nullable(auditStampPipe),
	result: actionResultPipe,
})
export type Action = Omit<PipeOutput<typeof actionPipe>, 'result'> & { result: ActionResult }
