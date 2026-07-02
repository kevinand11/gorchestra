import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import { ModelUseFormDraft } from './model-use'
import type { PlanConfigInput } from '../composables/useServerApi'

type PlanCreationFormFields = {
	title: string
	initialMessage: string
	planningModelUse: ModelUseFormDraft
}

type PlanCreationFormModel = {
	title: string
	initialMessage: string
	config: PlanConfigInput
}

const planTitlePipe = v.string().pipe(v.min<string>(1, 'Enter a Plan title'))
const initialMessagePipe = v.string().pipe(v.min<string>(1, 'Enter an initial planning message'))

export class PlanCreationFormDraft extends FormDraft<PlanCreationFormModel, PlanCreationFormModel, PlanCreationFormFields> {
	protected readonly rules = {
		title: planTitlePipe,
		initialMessage: initialMessagePipe,
		planningModelUse: formDraftPipe<ModelUseFormDraft>(),
	}

	constructor() {
		super({ title: '', initialMessage: '', planningModelUse: new ModelUseFormDraft() })
	}

	protected model = (): PlanCreationFormModel => ({
		title: this.title,
		initialMessage: this.initialMessage,
		config: { model: { planning: this.planningModelUse.toModel() } },
	})

	protected load = (entity: PlanCreationFormModel): void => {
		this.title = entity.title
		this.initialMessage = entity.initialMessage
		this.planningModelUse.loadEntity(entity.config.model?.planning ?? null)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('PlanCreationFormDraft', () => {
		it('models valid Plan creation input without transforming visible fields', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = '  Repository setup plan  '
			factory.initialMessage = '  Please plan repository onboarding.  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				title: '  Repository setup plan  ',
				initialMessage: '  Please plan repository onboarding.  ',
				config: { model: { planning: null } },
			})
		})

		it('models explicit Planning Model overrides', () => {
			const factory = new PlanCreationFormDraft()

			factory.title = 'Plan'
			factory.initialMessage = 'Plan this.'
			factory.planningModelUse.modelId = 'model-1'

			expect(factory.toModel()).toEqual({
				title: 'Plan',
				initialMessage: 'Plan this.',
				config: { model: { planning: { modelId: 'model-1', thinkingLevel: 'off' } } },
			})
		})

		it('rejects empty Plan creation input', () => {
			const factory = new PlanCreationFormDraft().loadEntity({
				title: 'Plan',
				initialMessage: 'Plan this.',
				config: { model: { planning: null } },
			})

			factory.title = ''
			factory.initialMessage = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.title).toBe('Enter a Plan title')
			expect(factory.errors.initialMessage).toBe('Enter an initial planning message')
		})
	})
}
