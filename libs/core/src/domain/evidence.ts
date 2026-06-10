import { v, type PipeOutput } from 'valleyed'

import { nonEmptyTrimmedStringPipe } from './commons'

export const validationOperationPipe = v.discriminate((value) => value.type, {
	'delivery-preflight': v.object({ type: v.eq('delivery-preflight') }),
	'model-preflight': v.object({ type: v.eq('model-preflight') }),
	'repository-preflight': v.object({ type: v.eq('repository-preflight') }),
	'slice-branch-validation': v.object({ type: v.eq('slice-branch-validation') }),
	'delivery-branch-validation': v.object({ type: v.eq('delivery-branch-validation') }),
})
export type ValidationOperation = PipeOutput<typeof validationOperationPipe>

export const validationEvidencePipe = v.object({
	type: v.eq('validation'),
	operation: validationOperationPipe,
	passed: v.boolean(),
	summary: nonEmptyTrimmedStringPipe,
})
export type ValidationEvidence = PipeOutput<typeof validationEvidencePipe>

export const externalOperationPipe = v.discriminate((value) => value.type, {
	'create-artifact': v.object({ type: v.eq('create-artifact') }),
	'push-branch': v.object({ type: v.eq('push-branch') }),
	'create-review-surface': v.object({ type: v.eq('create-review-surface') }),
	'merge-review-surface': v.object({ type: v.eq('merge-review-surface') }),
	'observe-artifact-integration': v.object({ type: v.eq('observe-artifact-integration') }),
	'close-review-surface': v.object({ type: v.eq('close-review-surface') }),
	'fetch-feedback': v.object({ type: v.eq('fetch-feedback') }),
})
export type ExternalOperation = PipeOutput<typeof externalOperationPipe>

export const externalOperationEvidencePipe = v.object({
	type: v.eq('external-operation'),
	operation: externalOperationPipe,
	passed: v.boolean(),
	summary: nonEmptyTrimmedStringPipe,
})
export type ExternalOperationEvidence = PipeOutput<typeof externalOperationEvidencePipe>

export type CorrectionEvidence = ValidationEvidence | ExternalOperationEvidence
