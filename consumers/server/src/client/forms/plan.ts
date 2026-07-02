import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { ModelThinkingLevel, ModelUseConfig, PlanConfigInput } from '../composables/useServerApi'

type PlanCreationFormFields = {
	title: string
	initialMessage: string
	planningModelId: string
	planningThinkingLevel: ModelThinkingLevel
}

type PlanCreationFormModel = {
	title: string
	initialMessage: string
	config: PlanConfigInput
}

const planTitlePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Plan title'))
const initialMessagePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter an initial planning message'))
const optionalModelIdPipe = v.string().pipe(v.asTrimmed())
const thinkingLevelPipe = v.in(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const)

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = {
		title: planTitlePipe,
		initialMessage: initialMessagePipe,
		planningModelId: optionalModelIdPipe,
		planningThinkingLevel: thinkingLevelPipe,
	}

	constructor() {
		super({ title: '', initialMessage: '', planningModelId: '', planningThinkingLevel: 'off' })
	}

	protected model = (): PlanCreationFormModel => ({
		title: this.title,
		initialMessage: this.initialMessage,
		config: { model: { planning: optionalModelUse(this.planningModelId, this.planningThinkingLevel) } },
	})

	protected load = (entity: PlanCreationFormModel): void => {
		const planning = planningModelUseFields(entity.config)

		this.title = entity.title
		this.initialMessage = entity.initialMessage
		this.planningModelId = planning.modelId
		this.planningThinkingLevel = planning.thinkingLevel
	}
}

function planningModelUseFields(config: PlanConfigInput): { modelId: string; thinkingLevel: ModelThinkingLevel } {
	if (config.model === null || config.model.planning === null) return { modelId: '', thinkingLevel: 'off' }
	return config.model.planning
}

function optionalModelUse(modelId: string, thinkingLevel: ModelThinkingLevel): ModelUseConfig | null {
	const trimmed = modelId.trim()
	return trimmed.length === 0 ? null : { modelId: trimmed, thinkingLevel }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('trims and models valid Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '
			factory.initialMessage = '  Please plan repository onboarding.  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				title: 'Repository setup plan',
				initialMessage: 'Please plan repository onboarding.',
				config: { model: { planning: null } },
			})
		})

		it('models explicit Planning Model overrides', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = 'Plan'
			factory.initialMessage = 'Plan this.'
			factory.planningModelId = ' model-1 '

			expect(factory.toModel()).toEqual({
				title: 'Plan',
				initialMessage: 'Plan this.',
				config: { model: { planning: { modelId: 'model-1', thinkingLevel: 'off' } } },
			})
		})

		it('rejects empty Plan creation input', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  '
			factory.initialMessage = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
			expect(factory.errors.initialMessage).toBe('Enter an initial planning message')
		})
	})
}
