import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { ModelThinkingLevel, ModelUseConfig, PortfolioConfigInput } from '../composables/useServerApi'

export type PortfolioConfigFormModel = { config: PortfolioConfigInput }

type PortfolioConfigFormFields = {
	defaultModelId: string
	defaultThinkingLevel: ModelThinkingLevel
	planningModelId: string
	planningThinkingLevel: ModelThinkingLevel
	revisionPlanningModelId: string
	revisionPlanningThinkingLevel: ModelThinkingLevel
	executionModelId: string
	executionThinkingLevel: ModelThinkingLevel
	revisionExecutionModelId: string
	revisionExecutionThinkingLevel: ModelThinkingLevel
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
	modelTimeoutMs: number
}

const requiredModelIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select a default Model'))
const optionalModelIdPipe = v.string().pipe(v.asTrimmed())
const thinkingLevelPipe = v.in(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const)
const positiveIntegerFieldPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeIntegerFieldPipe = v.number().pipe(v.int(), v.gte(0))

export class PortfolioConfigFormDraft extends FormDraft<PortfolioConfigFormModel, PortfolioConfigFormModel, PortfolioConfigFormFields> {
	protected readonly rules = {
		defaultModelId: requiredModelIdPipe,
		defaultThinkingLevel: thinkingLevelPipe,
		planningModelId: optionalModelIdPipe,
		planningThinkingLevel: thinkingLevelPipe,
		revisionPlanningModelId: optionalModelIdPipe,
		revisionPlanningThinkingLevel: thinkingLevelPipe,
		executionModelId: optionalModelIdPipe,
		executionThinkingLevel: thinkingLevelPipe,
		revisionExecutionModelId: optionalModelIdPipe,
		revisionExecutionThinkingLevel: thinkingLevelPipe,
		maxProcessableSliceSlots: positiveIntegerFieldPipe,
		maxCorrectionRetriesPerFailure: nonNegativeIntegerFieldPipe,
		modelTimeoutMs: positiveIntegerFieldPipe,
	}

	constructor() {
		super({
			defaultModelId: '',
			defaultThinkingLevel: 'off',
			planningModelId: '',
			planningThinkingLevel: 'off',
			revisionPlanningModelId: '',
			revisionPlanningThinkingLevel: 'off',
			executionModelId: '',
			executionThinkingLevel: 'off',
			revisionExecutionModelId: '',
			revisionExecutionThinkingLevel: 'off',
			maxProcessableSliceSlots: 1,
			maxCorrectionRetriesPerFailure: 1,
			modelTimeoutMs: 30_000,
		})
	}

	protected model = (): PortfolioConfigFormModel => ({
		config: {
			model: {
				default: { modelId: this.defaultModelId, thinkingLevel: this.defaultThinkingLevel },
				planning: optionalModelUse(this.planningModelId, this.planningThinkingLevel),
				revisionPlanning: optionalModelUse(this.revisionPlanningModelId, this.revisionPlanningThinkingLevel),
				execution: optionalModelUse(this.executionModelId, this.executionThinkingLevel),
				revisionExecution: optionalModelUse(this.revisionExecutionModelId, this.revisionExecutionThinkingLevel),
			},
			work: {
				maxProcessableSliceSlots: this.maxProcessableSliceSlots,
				maxCorrectionRetriesPerFailure: this.maxCorrectionRetriesPerFailure,
				modelTimeoutMs: this.modelTimeoutMs,
			},
		},
	})

	protected load = (entity: PortfolioConfigFormModel): void => {
		const model = entity.config.model
		const work = deliveryWorkConfigFields(entity.config.work)

		const planning = optionalModelUseFields(model.planning)
		const revisionPlanning = optionalModelUseFields(model.revisionPlanning)
		const execution = optionalModelUseFields(model.execution)
		const revisionExecution = optionalModelUseFields(model.revisionExecution)

		this.defaultModelId = model.default.modelId
		this.defaultThinkingLevel = model.default.thinkingLevel
		this.planningModelId = planning.modelId
		this.planningThinkingLevel = planning.thinkingLevel
		this.revisionPlanningModelId = revisionPlanning.modelId
		this.revisionPlanningThinkingLevel = revisionPlanning.thinkingLevel
		this.executionModelId = execution.modelId
		this.executionThinkingLevel = execution.thinkingLevel
		this.revisionExecutionModelId = revisionExecution.modelId
		this.revisionExecutionThinkingLevel = revisionExecution.thinkingLevel
		this.maxProcessableSliceSlots = work.maxProcessableSliceSlots
		this.maxCorrectionRetriesPerFailure = work.maxCorrectionRetriesPerFailure
		this.modelTimeoutMs = work.modelTimeoutMs
	}
}

function deliveryWorkConfigFields(work: PortfolioConfigInput['work']): NonNullable<PortfolioConfigInput['work']> {
	return work ?? defaultDeliveryWorkConfig()
}

function defaultDeliveryWorkConfig(): NonNullable<PortfolioConfigInput['work']> {
	return { maxProcessableSliceSlots: 1, maxCorrectionRetriesPerFailure: 1, modelTimeoutMs: 30_000 }
}

function optionalModelUseFields(modelUse: ModelUseConfig | null): { modelId: string; thinkingLevel: ModelThinkingLevel } {
	if (modelUse === null) return { modelId: '', thinkingLevel: 'off' }
	return modelUse
}

function optionalModelUse(modelId: string, thinkingLevel: ModelThinkingLevel): ModelUseConfig | null {
	const trimmed = modelId.trim()
	return trimmed.length === 0 ? null : { modelId: trimmed, thinkingLevel }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PortfolioConfigFormDraft', () => {
		it('uses conservative Delivery work defaults', () => {
			const factory = new PortfolioConfigFormDraft()

			expect(factory.maxProcessableSliceSlots).toBe(1)
			expect(factory.maxCorrectionRetriesPerFailure).toBe(1)
			expect(factory.modelTimeoutMs).toBe(30_000)
		})

		it('models Portfolio Config with nullable purpose Model Use Config values', () => {
			const factory = new PortfolioConfigFormDraft()

			factory.defaultModelId = ' model-default '
			factory.planningModelId = ' '
			factory.revisionPlanningModelId = ' model-revision-planning '
			factory.executionModelId = ' '
			factory.revisionExecutionModelId = ' model-revision-execution '
			factory.maxProcessableSliceSlots = 2
			factory.maxCorrectionRetriesPerFailure = 0
			factory.modelTimeoutMs = 60_000

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				config: {
					model: {
						default: { modelId: 'model-default', thinkingLevel: 'off' },
						planning: null,
						revisionPlanning: { modelId: 'model-revision-planning', thinkingLevel: 'off' },
						execution: null,
						revisionExecution: { modelId: 'model-revision-execution', thinkingLevel: 'off' },
					},
					work: { maxProcessableSliceSlots: 2, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 60_000 },
				},
			})
		})

		it('loads null work config with conservative defaults', () => {
			const factory = new PortfolioConfigFormDraft()

			factory.loadEntity({
				config: {
					model: {
						default: { modelId: 'model-default', thinkingLevel: 'off' },
						planning: null,
						revisionPlanning: null,
						execution: null,
						revisionExecution: null,
					},
					work: null,
				},
			})

			expect(factory.maxProcessableSliceSlots).toBe(1)
			expect(factory.toModel().config.work).toEqual({
				maxProcessableSliceSlots: 1,
				maxCorrectionRetriesPerFailure: 1,
				modelTimeoutMs: 30_000,
			})
		})
	})
}
