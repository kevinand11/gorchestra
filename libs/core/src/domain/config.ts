import { v, type PipeOutput } from 'valleyed'

import type { AgentRunPurpose } from './agent-run'
import { auditStampPipe, idPipe, nonNegativeIntegerPipe, positiveIntegerPipe, type Id } from './commons'

export const deliveryWorkConfigPipe = v.object({
	maxProcessableSliceSlots: positiveIntegerPipe,
	maxCorrectionRetriesPerFailure: nonNegativeIntegerPipe,
	modelTimeoutMs: positiveIntegerPipe,
})
export type DeliveryWorkConfig = PipeOutput<typeof deliveryWorkConfigPipe>

export const projectModelConfigPipe = v.object({
	planningModelId: v.nullable(idPipe),
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
export type ProjectModelConfig = PipeOutput<typeof projectModelConfigPipe>

export const portfolioModelConfigPipe = v.object({
	defaultModelId: idPipe,
	planningModelId: v.nullable(idPipe),
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
export type PortfolioModelConfig = PipeOutput<typeof portfolioModelConfigPipe>

export const planModelConfigPipe = v.object({ planningModelId: v.nullable(idPipe) })
export type PlanModelConfig = PipeOutput<typeof planModelConfigPipe>

export const deliveryModelConfigPipe = v.object({
	revisionPlanningModelId: v.nullable(idPipe),
	executionModelId: v.nullable(idPipe),
	revisionExecutionModelId: v.nullable(idPipe),
})
export type DeliveryModelConfig = PipeOutput<typeof deliveryModelConfigPipe>

export const portfolioConfigPipe = v.object({ model: portfolioModelConfigPipe, work: v.nullable(deliveryWorkConfigPipe) })
export type PortfolioConfig = PipeOutput<typeof portfolioConfigPipe>

export const projectConfigPipe = v.object({
	model: v.nullable(projectModelConfigPipe),
	work: v.nullable(deliveryWorkConfigPipe),
})
export type ProjectConfig = PipeOutput<typeof projectConfigPipe>

export const planConfigPipe = v.object({ model: v.nullable(planModelConfigPipe) })
export type PlanConfig = PipeOutput<typeof planConfigPipe>

export const deliveryConfigPipe = v.object({
	model: v.nullable(deliveryModelConfigPipe),
	work: v.nullable(deliveryWorkConfigPipe),
})
export type DeliveryConfig = PipeOutput<typeof deliveryConfigPipe>

export const portfolioConfigRecordPipe = v.object({ configured: auditStampPipe, value: portfolioConfigPipe })
export type PortfolioConfigRecord = PipeOutput<typeof portfolioConfigRecordPipe>

export const projectConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(projectConfigPipe) })
export type ProjectConfigRecord = PipeOutput<typeof projectConfigRecordPipe>

export const planConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(planConfigPipe) })
export type PlanConfigRecord = PipeOutput<typeof planConfigRecordPipe>

export const deliveryConfigRecordPipe = v.object({ configured: auditStampPipe, value: v.nullable(deliveryConfigPipe) })
export type DeliveryConfigRecord = PipeOutput<typeof deliveryConfigRecordPipe>

export type AgentRunModelResolution = {
	purpose: AgentRunPurpose['type']
	selectedModelId: Id
}

export type DeliveryWorkConfigResolution = DeliveryWorkConfig
