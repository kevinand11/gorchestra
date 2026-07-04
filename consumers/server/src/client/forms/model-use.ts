import { FormDraft, FormDraftSelect, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { ModelThinkingLevel, ModelUseConfig } from '../composables/core/server-api'

export type ModelUseFormModel = ModelUseConfig | null

type ModelUseFormFields = {
	modelId: FormDraftSelect<string | null>
	thinkingLevel: FormDraftSelect<ModelThinkingLevel>
}

type ModelUseFormDraftOptions = {
	required?: boolean
}

const thinkingLevelValues: ModelThinkingLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const modelRequiredMessage = 'Select a Model'
const thinkingLevelMessage = 'Select a Thinking Level'

export class ModelUseFormDraft extends FormDraft<ModelUseFormModel, ModelUseFormModel, ModelUseFormFields> {
	readonly requiresModel: boolean

	protected readonly rules = {
		modelId: formDraftPipe<FormDraftSelect<string | null>>(),
		thinkingLevel: formDraftPipe<FormDraftSelect<ModelThinkingLevel>>(),
	}

	constructor(options: ModelUseFormDraftOptions = {}) {
		const requiresModel = options.required === true
		super({
			modelId: new FormDraftSelect<string | null>({
				initialValue: null,
				pipe: (base) => base.pipe(v.custom((value) => modelIdIsValid(value, requiresModel), modelRequiredMessage)),
			}),
			thinkingLevel: new FormDraftSelect<ModelThinkingLevel>({
				initialValue: 'none',
				pipe: (base) => base.pipe(v.custom((value) => thinkingLevelValues.includes(value), thinkingLevelMessage)),
			}),
		})
		this.requiresModel = requiresModel
	}

	protected model = (): ModelUseFormModel =>
		this.modelId.value === null ? null : { modelId: this.modelId.value, thinkingLevel: this.thinkingLevel.value }

	protected load = (entity: ModelUseFormModel): void => {
		const fields = modelUseFields(entity)
		this.modelId.loadEntity(fields.modelId)
		this.thinkingLevel.loadEntity(fields.thinkingLevel)
	}
}

function modelIdIsValid(value: string | null, required: boolean): boolean {
	return value === null ? !required : value.length > 0
}

function modelUseFields(modelUse: ModelUseConfig | null): { modelId: string | null; thinkingLevel: ModelThinkingLevel } {
	return modelUse === null ? { modelId: null, thinkingLevel: 'none' } : modelUse
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelUseFormDraft', () => {
		it('models empty model selection as inherited null', () => {
			const draft = new ModelUseFormDraft()

			expect(draft.toModel()).toBeNull()
		})

		it('requires a Model when constructed as required', () => {
			const draft = new ModelUseFormDraft({ required: true }).loadEntity({ modelId: 'model-1', thinkingLevel: 'none' })

			draft.modelId.value = null

			expect(draft.valid).toBe(false)
			expect(draft.errors.modelId).toBe(modelRequiredMessage)
		})

		it('rejects unavailable Models after selectable options load', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId.value = 'model-stale'
			draft.modelId.setOptions([null, 'model-1'])

			expect(draft.valid).toBe(false)
			expect(draft.errors.modelId).toBe('Selected option is unavailable')
		})

		it('rejects unsupported Thinking Levels when supported levels are set', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId.value = 'model-1'
			draft.thinkingLevel.setOptions(['none', 'low'])
			draft.thinkingLevel.value = 'high'

			expect(draft.valid).toBe(false)
			expect(draft.errors.thinkingLevel).toBe('Selected option is unavailable')
		})

		it('models atomic Model Use Config', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId.value = 'model-1'
			draft.thinkingLevel.value = 'high'

			expect(draft.toModel()).toEqual({ modelId: 'model-1', thinkingLevel: 'high' })
		})

		it('loads null and present Model Use Config values', () => {
			const draft = new ModelUseFormDraft()

			draft.loadEntity({ modelId: 'model-1', thinkingLevel: 'low' })
			expect(draft.modelId.value).toBe('model-1')
			expect(draft.thinkingLevel.value).toBe('low')

			draft.loadEntity(null)
			expect(draft.modelId.value).toBeNull()
			expect(draft.thinkingLevel.value).toBe('none')
		})
	})
}
