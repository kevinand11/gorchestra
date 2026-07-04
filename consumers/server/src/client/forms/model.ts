import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type {
	CreateModelInput,
	ModelCapabilities,
	ModelThinkingCapability,
	ModelTokenPricing,
	PositiveModelThinkingLevel,
	UpdateModelInput,
} from '../composables/core/server-api'

export type ModelCreationFormModel = CreateModelInput
export type ModelUpdateFormModel = UpdateModelInput

export const positiveThinkingLevels: PositiveModelThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

type ModelCreationFormFields = {
	name: string
	providerModelId: string
}

type ModelUpdateFormFields = {
	name: string
	capabilities: ModelCapabilitiesFormDraft
	pricing: ModelPricingFormDraft
}

type ModelCapabilitiesFormFields = {
	inputs: ModelCapabilities['inputs']
	contextWindowTokens: number
	maxOutputTokens: number
	thinking: ModelThinkingFormDraft
}

type ModelThinkingFormFields = Record<PositiveModelThinkingLevel, boolean>

type ModelPricingFormFields = {
	enabled: boolean
	inputUsdPerMillion: number
	outputUsdPerMillion: number
	cacheReadUsdPerMillion: number
	cacheWriteUsdPerMillion: number
}

const modelNamePipe = v.string().pipe(v.min<string>(1, 'Enter a Model name'))
const providerModelIdPipe = v.string().pipe(v.min<string>(1, 'Enter a provider model id'))
const modelInputsPipe = v.array(v.in(['text']))
const positiveIntegerPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeNumberPipe = v.number().pipe(v.gte(0))

const defaultModelCapabilities: ModelCapabilities = {
	inputs: ['text'],
	contextWindowTokens: 128000,
	maxOutputTokens: 16384,
	thinking: null,
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

export class ModelThinkingFormDraft extends FormDraft<
	ModelThinkingCapability | null,
	ModelThinkingCapability | null,
	ModelThinkingFormFields
> {
	protected readonly rules = {
		minimal: v.boolean(),
		low: v.boolean(),
		medium: v.boolean(),
		high: v.boolean(),
		xhigh: v.boolean(),
	}
	#configurableLevels = new Set<PositiveModelThinkingLevel>(positiveThinkingLevels)

	constructor() {
		super(emptyThinkingFields())
	}

	setConfigurableLevels(levels: PositiveModelThinkingLevel[]): void {
		this.#configurableLevels = new Set(levels)
		for (const level of positiveThinkingLevels) {
			if (!this.#configurableLevels.has(level)) this[level] = false
		}
	}

	protected model = (): ModelThinkingCapability | null => {
		const supportedLevels = positiveThinkingLevels.filter((level) => this.#configurableLevels.has(level) && this[level])
		return supportedLevels.length === 0 ? null : { supportedLevels }
	}

	protected load = (entity: ModelThinkingCapability | null): void => {
		const supportedLevels = new Set(entity?.supportedLevels ?? [])
		for (const level of positiveThinkingLevels) {
			this[level] = this.#configurableLevels.has(level) && supportedLevels.has(level)
		}
	}
}

export class ModelCapabilitiesFormDraft extends FormDraft<ModelCapabilities, ModelCapabilities, ModelCapabilitiesFormFields> {
	protected readonly rules = {
		inputs: modelInputsPipe,
		contextWindowTokens: positiveIntegerPipe,
		maxOutputTokens: positiveIntegerPipe,
		thinking: formDraftPipe<ModelThinkingFormDraft>(),
	}

	constructor() {
		super({ ...defaultModelCapabilities, thinking: new ModelThinkingFormDraft() })
	}

	setConfigurableThinkingLevels(levels: PositiveModelThinkingLevel[]): void {
		this.thinking.setConfigurableLevels(levels)
	}

	protected model = (): ModelCapabilities => ({
		inputs: this.inputs,
		contextWindowTokens: this.contextWindowTokens,
		maxOutputTokens: this.maxOutputTokens,
		thinking: this.thinking.toModel(),
	})

	protected load = (entity: ModelCapabilities): void => {
		this.inputs = entity.inputs
		this.contextWindowTokens = entity.contextWindowTokens
		this.maxOutputTokens = entity.maxOutputTokens
		this.thinking.loadEntity(entity.thinking)
	}
}

export class ModelPricingFormDraft extends FormDraft<ModelTokenPricing | null, ModelTokenPricing | null, ModelPricingFormFields> {
	protected readonly rules = {
		enabled: v.boolean(),
		inputUsdPerMillion: nonNegativeNumberPipe,
		outputUsdPerMillion: nonNegativeNumberPipe,
		cacheReadUsdPerMillion: nonNegativeNumberPipe,
		cacheWriteUsdPerMillion: nonNegativeNumberPipe,
	}

	constructor() {
		super(emptyPricingFields())
	}

	clear(): void {
		const fields = emptyPricingFields()
		this.enabled = fields.enabled
		this.inputUsdPerMillion = fields.inputUsdPerMillion
		this.outputUsdPerMillion = fields.outputUsdPerMillion
		this.cacheReadUsdPerMillion = fields.cacheReadUsdPerMillion
		this.cacheWriteUsdPerMillion = fields.cacheWriteUsdPerMillion
	}

	protected model = (): ModelTokenPricing | null =>
		this.enabled
			? {
					unit: 'micro-usd-per-million-tokens',
					input: dollarsPerMillionToMicroUsd(this.inputUsdPerMillion),
					output: dollarsPerMillionToMicroUsd(this.outputUsdPerMillion),
					cacheRead: dollarsPerMillionToMicroUsd(this.cacheReadUsdPerMillion),
					cacheWrite: dollarsPerMillionToMicroUsd(this.cacheWriteUsdPerMillion),
				}
			: null

	protected load = (entity: ModelTokenPricing | null): void => {
		const fields = pricingFields(entity)
		this.enabled = fields.enabled
		this.inputUsdPerMillion = fields.inputUsdPerMillion
		this.outputUsdPerMillion = fields.outputUsdPerMillion
		this.cacheReadUsdPerMillion = fields.cacheReadUsdPerMillion
		this.cacheWriteUsdPerMillion = fields.cacheWriteUsdPerMillion
	}
}

export class ModelUpdateFormDraft extends FormDraft<ModelUpdateFormModel, ModelUpdateFormModel, ModelUpdateFormFields> {
	protected readonly rules = {
		name: modelNamePipe,
		capabilities: formDraftPipe<ModelCapabilitiesFormDraft>(),
		pricing: formDraftPipe<ModelPricingFormDraft>(),
	}

	constructor() {
		super({ name: '', capabilities: new ModelCapabilitiesFormDraft(), pricing: new ModelPricingFormDraft() })
	}

	setConfigurableThinkingLevels(levels: PositiveModelThinkingLevel[]): void {
		this.capabilities.setConfigurableThinkingLevels(levels)
	}

	protected model = (): ModelUpdateFormModel => ({
		name: this.name,
		capabilities: this.capabilities.toModel(),
		pricing: this.pricing.toModel(),
	})

	protected load = (entity: ModelUpdateFormModel): void => {
		this.name = entity.name
		this.capabilities.loadEntity(entity.capabilities)
		this.pricing.loadEntity(entity.pricing)
	}
}

function emptyThinkingFields(): ModelThinkingFormFields {
	return { minimal: false, low: false, medium: false, high: false, xhigh: false }
}

function emptyPricingFields(): ModelPricingFormFields {
	return {
		enabled: false,
		inputUsdPerMillion: 0,
		outputUsdPerMillion: 0,
		cacheReadUsdPerMillion: 0,
		cacheWriteUsdPerMillion: 0,
	}
}

function pricingFields(pricing: ModelTokenPricing | null): ModelPricingFormFields {
	if (pricing === null) return emptyPricingFields()
	return {
		enabled: true,
		inputUsdPerMillion: microUsdToDollarsPerMillion(pricing.input),
		outputUsdPerMillion: microUsdToDollarsPerMillion(pricing.output),
		cacheReadUsdPerMillion: microUsdToDollarsPerMillion(pricing.cacheRead),
		cacheWriteUsdPerMillion: microUsdToDollarsPerMillion(pricing.cacheWrite),
	}
}

function dollarsPerMillionToMicroUsd(value: number): number {
	return Math.round(value * 1_000_000)
}

function microUsdToDollarsPerMillion(value: number): number {
	return value / 1_000_000
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('ModelCreationFormDraft', () => {
		it('models Model creation input without transforming visible fields', () => {
			const factory = new ModelCreationFormDraft()

			factory.name = '  GPT 4.1  '
			factory.providerModelId = '  gpt-4.1  '

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({ name: '  GPT 4.1  ', providerModelId: '  gpt-4.1  ' })
		})

		it('rejects empty Model creation input', () => {
			const factory = new ModelCreationFormDraft().loadEntity({ name: 'Model', providerModelId: 'provider-model' })

			factory.name = ''
			factory.providerModelId = ''

			expect(factory.valid).toBe(false)
			expect(factory.errors.name).toBe('Enter a Model name')
			expect(factory.errors.providerModelId).toBe('Enter a provider model id')
		})
	})

	describe('ModelUpdateFormDraft', () => {
		it('models Model update input with nested capabilities and pricing drafts', () => {
			const factory = new ModelUpdateFormDraft()
			const pricing: ModelTokenPricing = {
				unit: 'micro-usd-per-million-tokens',
				input: 1_250_000,
				output: 2_500_000,
				cacheRead: 0,
				cacheWrite: 500_000,
			}

			factory.loadEntity({ name: 'Sonnet 4', capabilities: defaultModelCapabilities, pricing })
			factory.name = '  Sonnet 4 updated  '
			factory.capabilities.maxOutputTokens = 8192
			factory.capabilities.thinking.high = true
			factory.capabilities.thinking.low = true
			factory.pricing.inputUsdPerMillion = 1.125

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				name: '  Sonnet 4 updated  ',
				capabilities: {
					...defaultModelCapabilities,
					maxOutputTokens: 8192,
					thinking: { supportedLevels: ['low', 'high'] },
				},
				pricing: {
					unit: 'micro-usd-per-million-tokens',
					input: 1_125_000,
					output: 2_500_000,
					cacheRead: 0,
					cacheWrite: 500_000,
				},
			})
		})

		it('clears unconfigurable Model Thinking Levels', () => {
			const factory = new ModelUpdateFormDraft()
			factory.loadEntity({
				name: 'Gemini',
				capabilities: { ...defaultModelCapabilities, thinking: { supportedLevels: ['low', 'xhigh'] } },
				pricing: null,
			})

			factory.setConfigurableThinkingLevels(['minimal', 'low', 'medium', 'high'])

			expect(factory.capabilities.thinking.low).toBe(true)
			expect(factory.capabilities.thinking.xhigh).toBe(false)
			expect(factory.toModel().capabilities.thinking).toEqual({ supportedLevels: ['low'] })
		})
	})
}
