import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateModelInput, ModelCapabilities, ModelTokenPricing, UpdateModelInput } from '../composables/useServerApi'

export type ModelCreationFormModel = CreateModelInput
export type ModelUpdateFormModel = UpdateModelInput

type ModelCreationFormFields = {
	name: string
	providerModelId: string
}

type ModelUpdateFormFields = {
	name: string
	capabilities: ModelCapabilities
	pricing: ModelTokenPricing | null
}

const modelNamePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Model name'))
const providerModelIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a provider model id'))
const passThroughPipe = v.any<unknown>()

const defaultModelCapabilities: ModelCapabilities = {
	inputs: ['text'],
	contextWindowTokens: 128000,
	maxOutputTokens: 16384,
	reasoning: null,
}

export class ModelCreationFormDraft extends FormDraft<ModelCreationFormModel, ModelCreationFormModel, ModelCreationFormFields> {
	protected readonly rules = { name: modelNamePipe, providerModelId: providerModelIdPipe }

	constructor() {
		super({ name: '', providerModelId: '' })
	}

	protected model = (): ModelCreationFormModel => ({ name: this.name, providerModelId: this.providerModelId })

	protected load = (entity: ModelCreationFormModel): void => {
		this.name = entity.name
		this.providerModelId = entity.providerModelId
	}
}

export class ModelUpdateFormDraft extends FormDraft<ModelUpdateFormModel, ModelUpdateFormModel, ModelUpdateFormFields> {
	protected readonly rules = { name: modelNamePipe, capabilities: passThroughPipe, pricing: passThroughPipe }

	constructor() {
		super({ name: '', capabilities: defaultModelCapabilities, pricing: null })
	}

	protected model = (): ModelUpdateFormModel => ({ name: this.name, capabilities: this.capabilities, pricing: this.pricing })

	protected load = (entity: ModelUpdateFormModel): void => {
		this.name = entity.name
		this.capabilities = entity.capabilities
		this.pricing = entity.pricing
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelCreationFormDraft', () => {
		it('trims and models Model creation input', () => {
			const factory = new ModelCreationFormDraft()

			factory.name = '  GPT 4.1  '
			factory.providerModelId = '  gpt-4.1  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: 'GPT 4.1', providerModelId: 'gpt-4.1' })
		})

		it('rejects empty Model creation input', () => {
			const factory = new ModelCreationFormDraft()

			factory.name = '  '
			factory.providerModelId = '  '

			expect(factory.valid).toBe(false)
			expect(factory.errors.name).toBe('Enter a Model name')
			expect(factory.errors.providerModelId).toBe('Enter a provider model id')
		})
	})

	describe('ModelUpdateFormDraft', () => {
		it('trims and models Model update input with existing metadata', () => {
			const factory = new ModelUpdateFormDraft()
			const pricing: ModelTokenPricing = { unit: 'micro-usd-per-million-tokens', input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }

			factory.loadEntity({ name: '  Sonnet 4  ', capabilities: defaultModelCapabilities, pricing })
			factory.name = '  Sonnet 4 updated  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: 'Sonnet 4 updated', capabilities: defaultModelCapabilities, pricing })
		})
	})
}
