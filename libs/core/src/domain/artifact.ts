import { v, type PipeOutput } from 'valleyed'

import { idPipe, nonEmptyTrimmedStringPipe, runtimeRecordPipe } from './commons'
export const deliveryArtifactConfigPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.eq('source-control'), deliveryBranch: nonEmptyTrimmedStringPipe }),
})
export type DeliveryArtifactConfig = PipeOutput<typeof deliveryArtifactConfigPipe>
export type DeliveryArtifactType = DeliveryArtifactConfig['type']
export type SourceControlDeliveryArtifactConfig = Extract<DeliveryArtifactConfig, { type: 'source-control' }>

export const deliveryArtifactPipe = v.object({
	id: idPipe,
	deliveryId: idPipe,
	config: deliveryArtifactConfigPipe,
	created: runtimeRecordPipe,
})
export type DeliveryArtifact = PipeOutput<typeof deliveryArtifactPipe>

export const sliceArtifactConfigPipe = v.discriminate((value) => value.type, {
	'source-control': v.object({ type: v.eq('source-control'), sliceBranch: nonEmptyTrimmedStringPipe }),
})
export type SliceArtifactConfig = PipeOutput<typeof sliceArtifactConfigPipe>
export type SliceArtifactType = SliceArtifactConfig['type']
export type SourceControlSliceArtifactConfig = Extract<SliceArtifactConfig, { type: 'source-control' }>

export const sliceArtifactPipe = v.object({
	id: idPipe,
	sliceId: idPipe,
	config: sliceArtifactConfigPipe,
	created: runtimeRecordPipe,
})
export type SliceArtifact = PipeOutput<typeof sliceArtifactPipe>
