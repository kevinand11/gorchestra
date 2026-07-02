import { FormDraft, formDraftPipe } from '@gorchestra/form-draft'
import { v } from 'valleyed'

import type {
	CreateModelInput,
	ModelCapabilities,
	ModelThinkingLevel,
	ModelThinkingLevelMap,
	ModelTokenPricing,
	UpdateModelInput,
} from '../composables/core/server-api'

export type ModelCreationFormModel = CreateModelInput
export type ModelUpdateFormModel = UpdateModelInput

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
	reasoning: ModelReasoningFormDraft
}

type ModelReasoningFormFields = Record<ModelThinkingLevel, ModelReasoningLevelFormDraft>

type ModelReasoningLevelModel = ModelThinkingLevelMap[ModelThinkingLevel]

type ModelReasoningLevelFormFields = {
	enabled: boolean
	providerValue: string
}

type ModelPricingFormFields = {
	enabled: boolean
	inputUsdPerMillion: number
	outputUsdPerMillion: number
	cacheReadUsdPerMillion: number
	cacheWriteUsdPerMillion: number
}

const thinkingLevels: ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
const modelNamePipe = v.string().pipe(v.min<string>(1, 'Enter a Model name'))
const providerModelIdPipe = v.string().pipe(v.min<string>(1, 'Enter a provider model id'))
const modelInputsPipe = v.array(v.in(['text']))
const positiveIntegerPipe = v.number().pipe(v.int(), v.gte(1))
const nonNegativeNumberPipe = v.number().pipe(v.gte(0))
const enabledReasoningProviderValuePipe = v.string().pipe(v.min<string>(1, 'Enter a provider reasoning value'))

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

export class ModelReasoningLevelFormDraft extends FormDraft<
	ModelReasoningLevelModel,
	ModelReasoningLevelModel,
	ModelReasoningLevelFormFields
> {
	protected readonly rules = {
		enabled: v.boolean(),
		providerValue: v.lazy(() => (this.enabled ? enabledReasoningProviderValuePipe : v.string())),
	}

	constructor(private readonly defaultProviderValue: ModelThinkingLevel) {
		super({ enabled: false, providerValue: defaultProviderValue })
	}

	protected model = (): ModelReasoningLevelModel => (this.enabled ? { type: 'provider-value', value: this.providerValue } : null)

	protected load = (entity: ModelReasoningLevelModel): void => {
		this.enabled = entity !== null
		this.providerValue = entity?.value ?? this.defaultProviderValue
	}
}

export class ModelReasoningFormDraft extends FormDraft<
	ModelCapabilities['reasoning'],
	ModelCapabilities['reasoning'],
	ModelReasoningFormFields
> {
	protected readonly rules = modelReasoningRules()

	constructor() {
		super(modelReasoningDraftFields())
	}

	protected model = (): ModelCapabilities['reasoning'] => presentReasoningMap(this.reasoningMap())

	protected load = (entity: ModelCapabilities['reasoning']): void => {
		const reasoning = reasoningMapFields(entity)
		thinkingLevels.forEach((level) => this[level].loadEntity(reasoning[level]))
	}

	private reasoningMap(): ModelThinkingLevelMap {
		return {
			off: this.off.toModel(),
			minimal: this.minimal.toModel(),
			low: this.low.toModel(),
			medium: this.medium.toModel(),
			high: this.high.toModel(),
			xhigh: this.xhigh.toModel(),
		}
	}
}

export class ModelCapabilitiesFormDraft extends FormDraft<ModelCapabilities, ModelCapabilities, ModelCapabilitiesFormFields> {
	protected readonly rules = {
		inputs: modelInputsPipe,
		contextWindowTokens: positiveIntegerPipe,
		maxOutputTokens: positiveIntegerPipe,
		reasoning: formDraftPipe<ModelReasoningFormDraft>(),
	}

	constructor() {
		super({ ...defaultModelCapabilities, reasoning: new ModelReasoningFormDraft() })
	}

	protected model = (): ModelCapabilities => ({
		inputs: this.inputs,
		contextWindowTokens: this.contextWindowTokens,
		maxOutputTokens: this.maxOutputTokens,
		reasoning: this.reasoning.toModel(),
	})

	protected load = (entity: ModelCapabilities): void => {
		this.inputs = entity.inputs
		this.contextWindowTokens = entity.contextWindowTokens
		this.maxOutputTokens = entity.maxOutputTokens
		this.reasoning.loadEntity(entity.reasoning)
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

function modelReasoningDraftFields(): ModelReasoningFormFields {
	return {
		off: new ModelReasoningLevelFormDraft('off'),
		minimal: new ModelReasoningLevelFormDraft('minimal'),
		low: new ModelReasoningLevelFormDraft('low'),
		medium: new ModelReasoningLevelFormDraft('medium'),
		high: new ModelReasoningLevelFormDraft('high'),
		xhigh: new ModelReasoningLevelFormDraft('xhigh'),
	}
}

function modelReasoningRules() {
	return {
		off: formDraftPipe<ModelReasoningLevelFormDraft>(),
		minimal: formDraftPipe<ModelReasoningLevelFormDraft>(),
		low: formDraftPipe<ModelReasoningLevelFormDraft>(),
		medium: formDraftPipe<ModelReasoningLevelFormDraft>(),
		high: formDraftPipe<ModelReasoningLevelFormDraft>(),
		xhigh: formDraftPipe<ModelReasoningLevelFormDraft>(),
	}
}

function reasoningMapFields(reasoning: ModelCapabilities['reasoning']): ModelThinkingLevelMap {
	return reasoning ?? { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null }
}

function presentReasoningMap(reasoning: ModelThinkingLevelMap): ModelThinkingLevelMap | null {
	return thinkingLevels.some((level) => reasoning[level] !== null) ? reasoning : null
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
			factory.capabilities.reasoning.high.enabled = true
			factory.capabilities.reasoning.high.providerValue = 'high'
			factory.pricing.inputUsdPerMillion = 1.125

			expect(factory.valid).toBe(true)
			expect(factory.toModel()).toEqual({
				name: '  Sonnet 4 updated  ',
				capabilities: {
					...defaultModelCapabilities,
					maxOutputTokens: 8192,
					reasoning: {
						off: null,
						minimal: null,
						low: null,
						medium: null,
						high: { type: 'provider-value', value: 'high' },
						xhigh: null,
					},
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
	})
}
