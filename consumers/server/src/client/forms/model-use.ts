import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { ModelThinkingLevel, ModelUseConfig } from '../composables/core/server-api'

export type ModelUseFormModel = ModelUseConfig | null

type ModelUseFormFields = {
	modelId: string | null
	thinkingLevel: ModelThinkingLevel
}

type ModelUseFormDraftOptions = {
	required?: boolean
}

const modelIdPipe = v.string().pipe(v.min<string>(1, 'Select a Model'))
const thinkingLevelPipe = v.in(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

export class ModelUseFormDraft extends FormDraft<ModelUseFormModel, ModelUseFormModel, ModelUseFormFields> {
	private supportedThinkingLevels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
	private required = false

	protected readonly rules = {
		modelId: v.lazy(() => (this.required ? modelIdPipe : v.nullable(modelIdPipe))),
		thinkingLevel: v.lazy(() =>
			thinkingLevelPipe.pipe(
				v.custom<ModelThinkingLevel>((level) => this.supportsThinkingLevel(level), 'Select a supported Thinking Level'),
			),
		),
	}

	constructor(options: ModelUseFormDraftOptions = {}) {
		super({ modelId: null, thinkingLevel: 'off' })
		this.required = options.required === true
	}

	setSupportedThinkingLevels(levels: ModelThinkingLevel[]): void {
		this.supportedThinkingLevels = levels
		this.set('thinkingLevel', this.thinkingLevel)
	}

	protected model = (): ModelUseFormModel => (this.modelId === null ? null : { modelId: this.modelId, thinkingLevel: this.thinkingLevel })

	protected load = (entity: ModelUseFormModel): void => {
		const fields = modelUseFields(entity)
		this.modelId = fields.modelId
		this.thinkingLevel = fields.thinkingLevel
	}

	private supportsThinkingLevel(level: ModelThinkingLevel): boolean {
		return this.modelId === null || this.supportedThinkingLevels.includes(level)
	}
}

function modelUseFields(modelUse: ModelUseConfig | null): ModelUseFormFields {
	return modelUse === null ? { modelId: null, thinkingLevel: 'off' } : modelUse
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelUseFormDraft', () => {
		it('models empty model selection as inherited null', () => {
			const draft = new ModelUseFormDraft()

			expect(draft.toModel()).toBeNull()
		})

		it('requires a Model when constructed as required', () => {
			const draft = new ModelUseFormDraft({ required: true }).loadEntity({ modelId: 'model-1', thinkingLevel: 'off' })

			draft.modelId = null

			expect(draft.valid).toBe(false)
		})

		it('rejects unsupported Thinking Levels when supported levels are set', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId = 'model-1'
			draft.setSupportedThinkingLevels(['off', 'low'])
			draft.thinkingLevel = 'high'

			expect(draft.valid).toBe(false)
			expect(draft.errors.thinkingLevel).toBe('Select a supported Thinking Level')
		})

		it('models atomic Model Use Config', () => {
			const draft = new ModelUseFormDraft()

			draft.modelId = 'model-1'
			draft.thinkingLevel = 'high'

			expect(draft.toModel()).toEqual({ modelId: 'model-1', thinkingLevel: 'high' })
		})

		it('loads null and present Model Use Config values', () => {
			const draft = new ModelUseFormDraft()

			draft.loadEntity({ modelId: 'model-1', thinkingLevel: 'low' })
			expect(draft.modelId).toBe('model-1')
			expect(draft.thinkingLevel).toBe('low')

			draft.loadEntity(null)
			expect(draft.modelId).toBeNull()
			expect(draft.thinkingLevel).toBe('off')
		})
	})
}
