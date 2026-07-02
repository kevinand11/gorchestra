import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import { ModelUseFormDraft } from './model-use'
import type { ModelUseConfig, PortfolioConfigInput } from '../composables/core/server-api'

export type PortfolioConfigFormModel = { config: PortfolioConfigInput }

type PortfolioConfigFormFields = {
	defaultModelUse: ModelUseFormDraft
	planningModelUse: ModelUseFormDraft
	revisionPlanningModelUse: ModelUseFormDraft
	executionModelUse: ModelUseFormDraft
	revisionExecutionModelUse: ModelUseFormDraft
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
	modelTimeoutMs: number
}

const positiveIntegerFieldPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeIntegerFieldPipe = v.number().pipe(v.int(), v.gte(0))

export class PortfolioConfigFormDraft extends FormDraft<PortfolioConfigFormModel, PortfolioConfigFormModel, PortfolioConfigFormFields> {
	protected readonly rules = {
		defaultModelUse: formDraftPipe<ModelUseFormDraft>(),
		planningModelUse: formDraftPipe<ModelUseFormDraft>(),
		revisionPlanningModelUse: formDraftPipe<ModelUseFormDraft>(),
		executionModelUse: formDraftPipe<ModelUseFormDraft>(),
		revisionExecutionModelUse: formDraftPipe<ModelUseFormDraft>(),
		maxProcessableSliceSlots: positiveIntegerFieldPipe,
		maxCorrectionRetriesPerFailure: nonNegativeIntegerFieldPipe,
		modelTimeoutMs: positiveIntegerFieldPipe,
	}

	constructor() {
		super({
			defaultModelUse: new ModelUseFormDraft({ required: true }),
			planningModelUse: new ModelUseFormDraft(),
			revisionPlanningModelUse: new ModelUseFormDraft(),
			executionModelUse: new ModelUseFormDraft(),
			revisionExecutionModelUse: new ModelUseFormDraft(),
			maxProcessableSliceSlots: 1,
			maxCorrectionRetriesPerFailure: 1,
			modelTimeoutMs: 30_000,
		})
	}

	protected model = (): PortfolioConfigFormModel => ({
		config: {
			model: {
				default: requireModelUse(this.defaultModelUse.toModel()),
				planning: this.planningModelUse.toModel(),
				revisionPlanning: this.revisionPlanningModelUse.toModel(),
				execution: this.executionModelUse.toModel(),
				revisionExecution: this.revisionExecutionModelUse.toModel(),
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

		this.defaultModelUse.loadEntity(model.default)
		this.planningModelUse.loadEntity(model.planning)
		this.revisionPlanningModelUse.loadEntity(model.revisionPlanning)
		this.executionModelUse.loadEntity(model.execution)
		this.revisionExecutionModelUse.loadEntity(model.revisionExecution)
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

function requireModelUse(modelUse: ModelUseConfig | null): ModelUseConfig {
	if (modelUse === null) throw new Error('Default Model Use Config is required')
	return modelUse
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

			factory.defaultModelUse.modelId = 'model-default'
			factory.planningModelUse.modelId = null
			factory.revisionPlanningModelUse.modelId = 'model-revision-planning'
			factory.executionModelUse.modelId = null
			factory.revisionExecutionModelUse.modelId = 'model-revision-execution'
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
