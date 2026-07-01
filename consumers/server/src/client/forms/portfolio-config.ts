import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { PortfolioConfigInput } from '../composables/useServerApi'

export type PortfolioConfigFormModel = { config: PortfolioConfigInput }

type PortfolioConfigFormFields = {
	defaultModelId: string
	planningModelId: string
	revisionPlanningModelId: string
	executionModelId: string
	revisionExecutionModelId: string
	maxProcessableSliceSlots: number
	maxCorrectionRetriesPerFailure: number
	modelTimeoutMs: number
}

const requiredModelIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Select a default Model'))
const optionalModelIdPipe = v.string().pipe(v.asTrimmed())
const positiveIntegerFieldPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeIntegerFieldPipe = v.number().pipe(v.int(), v.gte(0))

export class PortfolioConfigFormDraft extends FormDraft<PortfolioConfigFormModel, PortfolioConfigFormModel, PortfolioConfigFormFields> {
	protected readonly rules = {
		defaultModelId: requiredModelIdPipe,
		planningModelId: optionalModelIdPipe,
		revisionPlanningModelId: optionalModelIdPipe,
		executionModelId: optionalModelIdPipe,
		revisionExecutionModelId: optionalModelIdPipe,
		maxProcessableSliceSlots: positiveIntegerFieldPipe,
		maxCorrectionRetriesPerFailure: nonNegativeIntegerFieldPipe,
		modelTimeoutMs: positiveIntegerFieldPipe,
	}

	constructor() {
		super({
			defaultModelId: '',
			planningModelId: '',
			revisionPlanningModelId: '',
			executionModelId: '',
			revisionExecutionModelId: '',
			maxProcessableSliceSlots: 1,
			maxCorrectionRetriesPerFailure: 1,
			modelTimeoutMs: 30_000,
		})
	}

	protected model = (): PortfolioConfigFormModel => ({
		config: {
			model: {
				defaultModelId: this.defaultModelId,
				planningModelId: nullableId(this.planningModelId),
				revisionPlanningModelId: nullableId(this.revisionPlanningModelId),
				executionModelId: nullableId(this.executionModelId),
				revisionExecutionModelId: nullableId(this.revisionExecutionModelId),
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

		this.defaultModelId = model.defaultModelId
		this.planningModelId = optionalModelField(model.planningModelId)
		this.revisionPlanningModelId = optionalModelField(model.revisionPlanningModelId)
		this.executionModelId = optionalModelField(model.executionModelId)
		this.revisionExecutionModelId = optionalModelField(model.revisionExecutionModelId)
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

function optionalModelField(modelId: string | null): string {
	return modelId ?? ''
}

function nullableId(value: string): string | null {
	return value.trim().length === 0 ? null : value.trim()
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

		it('models Portfolio Config with nullable purpose Models', () => {
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
						defaultModelId: 'model-default',
						planningModelId: null,
						revisionPlanningModelId: 'model-revision-planning',
						executionModelId: null,
						revisionExecutionModelId: 'model-revision-execution',
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
						defaultModelId: 'model-default',
						planningModelId: null,
						revisionPlanningModelId: null,
						executionModelId: null,
						revisionExecutionModelId: null,
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
