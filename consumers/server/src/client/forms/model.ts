import { FormDraft } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type { CreateModelInput, UpdateModelInput } from '../composables/useServerApi'

export type ModelCreationFormModel = CreateModelInput
export type ModelUpdateFormModel = UpdateModelInput

type ModelCreationFormFields = {
	name: string
	providerModelId: string
}

type ModelUpdateFormFields = {
	name: string
}

const modelNamePipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a Model name'))
const providerModelIdPipe = v.string().pipe(v.asTrimmed(), v.min<string>(1, 'Enter a provider model id'))

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
	protected readonly rules = { name: modelNamePipe }

	constructor() {
		super({ name: '' })
	}

	protected model = (): ModelUpdateFormModel => ({ name: this.name })

	protected load = (entity: ModelUpdateFormModel): void => {
		this.name = entity.name
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
		it('trims and models Model update input', () => {
			const factory = new ModelUpdateFormDraft()

			factory.name = '  Sonnet 4  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: 'Sonnet 4' })
		})
	})
}
