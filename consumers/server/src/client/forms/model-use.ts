import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { ModelThinkingLevel, ModelUseConfig } from '../composables/useServerApi'

export type ModelUseFormModel = ModelUseConfig | null

type ModelUseFormFields = {
	modelId: string
	thinkingLevel: ModelThinkingLevel
}

type ModelUseFormDraftOptions = {
	required?: boolean
}

export class ModelUseFormDraft extends FormDraft<ModelUseFormModel, ModelUseFormModel, ModelUseFormFields> {
	private supportedThinkingLevels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
	private required = false

	protected readonly rules = {
		modelId: v.string().pipe(
			v.asTrimmed(),
			v.lazy(() => v.min<string>(this.required ? 1 : 0, 'Select a Model')),
		),
		thinkingLevel: v.lazy(() => v.in(this.supportedThinkingLevels, 'Select a supported Thinking Level')),
	}

	constructor(options: ModelUseFormDraftOptions = {}) {
		super({ modelId: '', thinkingLevel: 'off' })
		this.required = options.required === true
	}

	setSupportedThinkingLevels(levels: ModelThinkingLevel[]): void {
		this.supportedThinkingLevels = levels
		this.set('thinkingLevel', this.thinkingLevel)
	}

	protected model = (): ModelUseFormModel => {
		const { modelId, thinkingLevel } = this.values
		if (!modelId) return null
		return { modelId, thinkingLevel }
	}

	protected load = (entity: ModelUseFormModel): void => {
		const fields = modelUseFields(entity)
		this.modelId = fields.modelId
		this.thinkingLevel = fields.thinkingLevel
	}
}

function modelUseFields(modelUse: ModelUseConfig | null): ModelUseFormFields {
	return modelUse === null ? { modelId: '', thinkingLevel: 'off' } : modelUse
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelUseFormDraft', () => {
		it('models empty model selection as inherited null', () => {
			const draft = new ModelUseFormDraft()

			expect(draft.toModel()).toBeNull()
		})

		it('requires a Model when constructed as required', () => {
			const draft = new ModelUseFormDraft({ required: true })

			draft.modelId = ' '

			expect(draft.valid).toBe(false)
			expect(draft.errors.modelId).toBe('Select a Model')
		})

		it('rejects unsupported Thinking Levels when supported levels are set', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId = 'model-1'
			draft.setSupportedThinkingLevels(['off', 'low'])
			draft.thinkingLevel = 'high'

			expect(draft.valid).toBe(false)
			expect(draft.errors.thinkingLevel).toBe('Select a supported Thinking Level')
		})

		it('trims and models atomic Model Use Config', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId = ' model-1 '
			draft.thinkingLevel = 'high'

			expect(draft.toModel()).toEqual({ modelId: 'model-1', thinkingLevel: 'high' })
		})

		it('loads null and present Model Use Config values', () => {
			const draft = new ModelUseFormDraft()

			draft.loadEntity({ modelId: 'model-1', thinkingLevel: 'low' })
			expect(draft.modelId).toBe('model-1')
			expect(draft.thinkingLevel).toBe('low')

			draft.loadEntity(null)
			expect(draft.modelId).toBe('')
			expect(draft.thinkingLevel).toBe('off')
		})
	})
}
