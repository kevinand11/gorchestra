import { v, type PipeOutput } from 'valleyed'

import { auditStampPipe, idPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from './commons'
import { modelThinkingLevelPipe } from './model'

export const modelUseConfigPipe = v.object({ modelId: idPipe, thinkingLevel: modelThinkingLevelPipe })
export type ModelUseConfig = PipeOutput<typeof modelUseConfigPipe>

export const deliveryWorkConfigPipe = v.object({
	maxProcessableSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	executionAgentRunProfileId: idPipe,
	revisionExecutionAgentRunProfileId: v.nullable(idPipe),
})
export type DeliveryWorkConfig = PipeOutput<typeof deliveryWorkConfigPipe>

export const projectConfigPipe = v.object({ work: deliveryWorkConfigPipe })
export type ProjectConfig = PipeOutput<typeof projectConfigPipe>

export const deliveryConfigPipe = v
	.object({ work: v.nullable(deliveryWorkConfigPipe) })
	.pipe((config) => (config.work === null ? null : config))
export type DeliveryConfig = NonNullable<PipeOutput<typeof deliveryConfigPipe>>

export const projectConfigRecordPipe = v.object({ configured: auditStampPipe, value: projectConfigPipe })
export type ProjectConfigRecord = PipeOutput<typeof projectConfigRecordPipe>

export const deliveryConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(deliveryConfigPipe) })
export type DeliveryConfigRecord = PipeOutput<typeof deliveryConfigRecordPipe>

export type DeliveryWorkConfigResolution = DeliveryWorkConfig

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Config domain pipes', () => {
		it('requires Project Config to carry Delivery work defaults', () => {
			expect(
				v.assert(projectConfigPipe, {
					work: {
						maxProcessableSliceSlots: 2,
						maxCorrectionRetriesPerFailure: 1,
						executionAgentRunProfileId: 'agent-run-profile-1',
						revisionExecutionAgentRunProfileId: null,
					},
				}),
			).toMatchObject({ work: { executionAgentRunProfileId: 'agent-run-profile-1' } })
		})

		it('normalizes a cleared Delivery Config override to null', () => {
			expect(v.assert(deliveryConfigPipe, { work: null })).toBeNull()
		})
	})
}
