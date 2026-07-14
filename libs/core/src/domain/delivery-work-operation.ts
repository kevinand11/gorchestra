import { v, type PipeOutput } from 'valleyed'

import { idPipe } from './commons'

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
