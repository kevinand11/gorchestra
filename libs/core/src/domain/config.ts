import { v, type PipeOutput } from 'valleyed'

import type { AgentRunPurpose } from './agent-run'
import { auditStampPipe, idPipe, nonNegativeIntegerPipe, positiveIntegerPipe } from './commons'
import { modelThinkingLevelPipe } from './model'

export const deliveryWorkConfigPipe = v.object({
	maxProcessableSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
export type DeliveryWorkConfig = PipeOutput<typeof deliveryWorkConfigPipe>

export const modelUseConfigPipe = v.object({ modelId: idPipe, thinkingLevel: modelThinkingLevelPipe })
export type ModelUseConfig = PipeOutput<typeof modelUseConfigPipe>

const rawProjectModelConfigPipe = v.object({
	planning: v.nullable(modelUseConfigPipe),
	revisionPlanning: v.nullable(modelUseConfigPipe),
	execution: v.nullable(modelUseConfigPipe),
	revisionExecution: v.nullable(modelUseConfigPipe),
})
type RawProjectModelConfig = PipeOutput<typeof rawProjectModelConfigPipe>

export const projectModelConfigPipe = rawProjectModelConfigPipe.pipe((model): RawProjectModelConfig | null => nullWhenAllValuesNull(model))
export type ProjectModelConfig = NonNullable<PipeOutput<typeof projectModelConfigPipe>>

export const portfolioModelConfigPipe = v.object({
	default: modelUseConfigPipe,
	planning: v.nullable(modelUseConfigPipe),
	revisionPlanning: v.nullable(modelUseConfigPipe),
	execution: v.nullable(modelUseConfigPipe),
	revisionExecution: v.nullable(modelUseConfigPipe),
})
export type PortfolioModelConfig = PipeOutput<typeof portfolioModelConfigPipe>

export const planModelConfigPipe = v
	.object({ planning: v.nullable(modelUseConfigPipe) })
	.pipe((model) => (model.planning === null ? null : model))
export type PlanModelConfig = NonNullable<PipeOutput<typeof planModelConfigPipe>>

const rawDeliveryModelConfigPipe = v.object({
	execution: v.nullable(modelUseConfigPipe),
	revisionExecution: v.nullable(modelUseConfigPipe),
})
type RawDeliveryModelConfig = PipeOutput<typeof rawDeliveryModelConfigPipe>

export const deliveryModelConfigPipe = rawDeliveryModelConfigPipe.pipe((model): RawDeliveryModelConfig | null =>
	nullWhenAllValuesNull(model),
)
export type DeliveryModelConfig = NonNullable<PipeOutput<typeof deliveryModelConfigPipe>>

export const portfolioConfigPipe = v.object({ model: portfolioModelConfigPipe, work: v.nullable(deliveryWorkConfigPipe) })
export type PortfolioConfig = PipeOutput<typeof portfolioConfigPipe>

export const projectConfigPipe = v
	.object({
		model: v.nullable(projectModelConfigPipe),
		work: v.nullable(deliveryWorkConfigPipe),
	})
	.pipe((config) => (config.model === null && config.work === null ? null : config))
export type ProjectConfig = NonNullable<PipeOutput<typeof projectConfigPipe>>

export const planConfigPipe = v.object({ model: v.nullable(planModelConfigPipe) }).pipe((config) => (config.model === null ? null : config))
export type PlanConfig = NonNullable<PipeOutput<typeof planConfigPipe>>

export const deliveryConfigPipe = v
	.object({
		model: v.nullable(deliveryModelConfigPipe),
		work: v.nullable(deliveryWorkConfigPipe),
	})
	.pipe((config) => (config.model === null && config.work === null ? null : config))
export type DeliveryConfig = NonNullable<PipeOutput<typeof deliveryConfigPipe>>

export const portfolioConfigRecordPipe = v.object({ configured: auditStampPipe, value: portfolioConfigPipe })
export type PortfolioConfigRecord = PipeOutput<typeof portfolioConfigRecordPipe>

export const projectConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(projectConfigPipe) })
export type ProjectConfigRecord = PipeOutput<typeof projectConfigRecordPipe>

export const planConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(planConfigPipe) })
export type PlanConfigRecord = PipeOutput<typeof planConfigRecordPipe>

export const deliveryConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(deliveryConfigPipe) })
export type DeliveryConfigRecord = PipeOutput<typeof deliveryConfigRecordPipe>

export type AgentRunModelUseResolution = {
	purpose: AgentRunPurpose['type']
	selectedModelUse: ModelUseConfig
}

export type DeliveryWorkConfigResolution = DeliveryWorkConfig

function nullWhenAllValuesNull<TValue extends object>(value: TValue): TValue | null {
	return Object.values(value).every((entry) => entry === null) ? null : value
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Config domain pipes', () => {
		it('normalizes all-inherited scoped config to null', () => {
			expect(v.assert(planConfigPipe, { model: { planning: null } })).toBeNull()
			expect(
				v.assert(projectConfigPipe, {
					model: { planning: null, revisionPlanning: null, execution: null, revisionExecution: null },
					work: null,
				}),
			).toBeNull()
			expect(v.assert(deliveryConfigPipe, { model: { execution: null, revisionExecution: null }, work: null })).toBeNull()
		})

		it('requires Portfolio Config to carry a default Model Use Config', () => {
			expect(
				v.assert(portfolioConfigPipe, {
					model: {
						default: { modelId: 'model-1', thinkingLevel: 'off' },
						planning: null,
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: null,
				}),
			).toMatchObject({ model: { default: { modelId: 'model-1', thinkingLevel: 'off' } } })
		})
	})
}
