import { v, type PipeOutput } from 'valleyed'

import {
	archivePeriodPipe,
	auditStampPipe,
	idPipe,
	nonEmptyTrimmedStringPipe,
	nonNegativeIntegerPipe,
	positiveIntegerPipe,
} from './commons'

export const modelThinkingLevelPipe = v.in(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
export type ModelThinkingLevel = PipeOutput<typeof modelThinkingLevelPipe>
export const modelThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const satisfies readonly ModelThinkingLevel[]

export const modelThinkingLevelProviderValuePipe = v.object({ type: v.eq('provider-value'), value: nonEmptyTrimmedStringPipe })
export type ModelThinkingLevelProviderValue = PipeOutput<typeof modelThinkingLevelProviderValuePipe>

const modelThinkingLevelMapEntryPipe = v.defaults(v.nullable(modelThinkingLevelProviderValuePipe), null)

export const modelThinkingLevelMapPipe = v.object({
	off: modelThinkingLevelMapEntryPipe,
	minimal: modelThinkingLevelMapEntryPipe,
	low: modelThinkingLevelMapEntryPipe,
	medium: modelThinkingLevelMapEntryPipe,
	high: modelThinkingLevelMapEntryPipe,
	xhigh: modelThinkingLevelMapEntryPipe,
})
export type ModelThinkingLevelMap = PipeOutput<typeof modelThinkingLevelMapPipe>

export const modelReasoningPipe = v.nullable(modelThinkingLevelMapPipe).pipe(normalizeReasoning)

export const modelInputPipe = v.in(['text'])
export type ModelInput = PipeOutput<typeof modelInputPipe>
export const modelInputsPipe = v.array(modelInputPipe).pipe(v.asSet()).pipe(v.min(1))

type RawModelCapabilities = {
	inputs: ModelInput[]
	contextWindowTokens: number
	maxOutputTokens: number
	reasoning: ModelThinkingLevelMap | null
}

export const modelCapabilitiesPipe = v
	.object({
		inputs: modelInputsPipe,
		contextWindowTokens: positiveIntegerPipe,
		maxOutputTokens: positiveIntegerPipe,
		reasoning: modelReasoningPipe,
	})
	.pipe(
		v.custom<RawModelCapabilities>(
			hasValidOutputTokenLimit,
			'Expected max output tokens to be less than or equal to context window tokens.',
		),
	)
export type ModelCapabilities = PipeOutput<typeof modelCapabilitiesPipe>

export const defaultModelCapabilities = {
	inputs: ['text'],
	contextWindowTokens: 128000,
	maxOutputTokens: 16384,
	reasoning: null,
} satisfies ModelCapabilities

export const modelTokenPricingPipe = v.object({
	unit: v.eq('micro-usd-per-million-tokens'),
	input: nonNegativeIntegerPipe,
	output: nonNegativeIntegerPipe,
	cacheRead: nonNegativeIntegerPipe,
	cacheWrite: nonNegativeIntegerPipe,
})
export type ModelTokenPricing = PipeOutput<typeof modelTokenPricingPipe>

export const modelPipe = v.object({
	id: idPipe,
	providerId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
	capabilities: modelCapabilitiesPipe,
	pricing: v.nullable(modelTokenPricingPipe),
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archivePeriods: v.array(archivePeriodPipe),
})
export type Model = PipeOutput<typeof modelPipe>

export const listedModelPipe = v.object({
	id: idPipe,
	providerId: idPipe,
	name: nonEmptyTrimmedStringPipe,
	providerModelId: nonEmptyTrimmedStringPipe,
	capabilities: modelCapabilitiesPipe,
	pricing: v.nullable(modelTokenPricingPipe),
	availableThinkingLevels: v.array(modelThinkingLevelPipe),
	created: auditStampPipe,
	updated: v.nullable(auditStampPipe),
	archived: v.boolean(),
})
export type ListedModel = PipeOutput<typeof listedModelPipe>

export function availableThinkingLevels(capabilities: Pick<ModelCapabilities, 'reasoning'>): ModelThinkingLevel[] {
	if (capabilities.reasoning === null) return ['off']
	return modelThinkingLevels.filter((level) => capabilities.reasoning?.[level] !== null)
}

function normalizeReasoning(value: ModelThinkingLevelMap | null): ModelThinkingLevelMap | null {
	if (value === null) return null
	return Object.values(value).every((entry) => entry === null) ? null : value
}

function hasValidOutputTokenLimit(capabilities: RawModelCapabilities): boolean {
	return capabilities.maxOutputTokens <= capabilities.contextWindowTokens
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Model domain pipes', () => {
		it('normalizes capabilities and configured reasoning provider values', () => {
			expect(
				v.assert(modelCapabilitiesPipe, {
					inputs: ['text', 'text'],
					contextWindowTokens: 128000,
					maxOutputTokens: 16384,
					reasoning: {
						off: undefined,
						minimal: null,
						low: null,
						medium: null,
						high: { type: 'provider-value', value: ' high ' },
						xhigh: null,
					},
				}),
			).toEqual({
				inputs: ['text'],
				contextWindowTokens: 128000,
				maxOutputTokens: 16384,
				reasoning: {
					off: null,
					minimal: null,
					low: null,
					medium: null,
					high: { type: 'provider-value', value: 'high' },
					xhigh: null,
				},
			})
		})

		it('normalizes an all-null reasoning map to unknown reasoning', () => {
			expect(
				v.assert(modelCapabilitiesPipe, {
					inputs: ['text'],
					contextWindowTokens: 128000,
					maxOutputTokens: 16384,
					reasoning: { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null },
				}),
			).toMatchObject({ reasoning: null })
		})

		it('rejects empty inputs and output limits larger than the context window', () => {
			expect(
				v.validate(modelCapabilitiesPipe, { inputs: [], contextWindowTokens: 1, maxOutputTokens: 1, reasoning: null }).valid,
			).toBe(false)
			expect(
				v.validate(modelCapabilitiesPipe, { inputs: ['text'], contextWindowTokens: 1, maxOutputTokens: 2, reasoning: null }).valid,
			).toBe(false)
		})
	})
}
