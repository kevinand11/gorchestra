import { v, type PipeOutput } from 'valleyed'

import {
	archivePeriodPipe,
	auditStampPipe,
	idPipe,
	nonEmptyTrimmedStringPipe,
	nonNegativeIntegerPipe,
	positiveIntegerPipe,
} from './commons'

export const positiveModelThinkingLevelPipe = v.in(['minimal', 'low', 'medium', 'high', 'xhigh'])
export type PositiveModelThinkingLevel = PipeOutput<typeof positiveModelThinkingLevelPipe>
export const positiveModelThinkingLevels = [
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
] as const satisfies readonly PositiveModelThinkingLevel[]

export const modelThinkingLevelPipe = v.in(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
export type ModelThinkingLevel = PipeOutput<typeof modelThinkingLevelPipe>
export const modelThinkingLevels = ['none', ...positiveModelThinkingLevels] as const satisfies readonly ModelThinkingLevel[]

type RawModelThinkingCapability = { supportedLevels: PositiveModelThinkingLevel[] }

export const modelThinkingCapabilityPipe = v
	.object({ supportedLevels: v.array(positiveModelThinkingLevelPipe).pipe(v.asSet()).pipe(v.min(1)) })
	.pipe((capability: RawModelThinkingCapability) => ({ supportedLevels: sortedPositiveThinkingLevels(capability.supportedLevels) }))
export type ModelThinkingCapability = PipeOutput<typeof modelThinkingCapabilityPipe>

export const modelInputPipe = v.in(['text'])
export type ModelInput = PipeOutput<typeof modelInputPipe>
export const modelInputsPipe = v.array(modelInputPipe).pipe(v.asSet()).pipe(v.min(1))

type RawModelCapabilities = {
	inputs: ModelInput[]
	contextWindowTokens: number
	maxOutputTokens: number
	thinking: ModelThinkingCapability | null
}

export const modelCapabilitiesPipe = v
	.object({
		inputs: modelInputsPipe,
		contextWindowTokens: positiveIntegerPipe,
		maxOutputTokens: positiveIntegerPipe,
		thinking: v.nullable(modelThinkingCapabilityPipe),
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
	thinking: null,
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

export const agentRunProfileModelReferencePipe = v.object({
	type: v.eq('agent-run-profile'),
	active: v.boolean(),
	agentRunProfileId: idPipe,
	agentRunProfileName: nonEmptyTrimmedStringPipe,
})
export type AgentRunProfileModelReference = PipeOutput<typeof agentRunProfileModelReferencePipe>

export const modelReferencePipe = v.discriminate((value) => value.type, {
	'agent-run-profile': agentRunProfileModelReferencePipe,
})
export type ModelReference = PipeOutput<typeof modelReferencePipe>

export function modelConfiguredThinkingLevels(capabilities: Pick<ModelCapabilities, 'thinking'>): PositiveModelThinkingLevel[] {
	return capabilities.thinking?.supportedLevels ?? []
}

function sortedPositiveThinkingLevels(levels: PositiveModelThinkingLevel[]): PositiveModelThinkingLevel[] {
	return positiveModelThinkingLevels.filter((level) => levels.includes(level))
}

function hasValidOutputTokenLimit(capabilities: RawModelCapabilities): boolean {
	return capabilities.maxOutputTokens <= capabilities.contextWindowTokens
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Model domain pipes', () => {
		it('normalizes capabilities and configured thinking support', () => {
			expect(
				v.assert(modelCapabilitiesPipe, {
					inputs: ['text', 'text'],
					contextWindowTokens: 128000,
					maxOutputTokens: 16384,
					thinking: { supportedLevels: ['high', 'low', 'high'] },
				}),
			).toEqual({
				inputs: ['text'],
				contextWindowTokens: 128000,
				maxOutputTokens: 16384,
				thinking: { supportedLevels: ['low', 'high'] },
			})
		})

		it('rejects empty thinking support, empty inputs, and output limits larger than the context window', () => {
			expect(
				v.validate(modelCapabilitiesPipe, {
					inputs: ['text'],
					contextWindowTokens: 128000,
					maxOutputTokens: 16384,
					thinking: { supportedLevels: [] },
				}).valid,
			).toBe(false)
			expect(
				v.validate(modelCapabilitiesPipe, { inputs: [], contextWindowTokens: 1, maxOutputTokens: 1, thinking: null }).valid,
			).toBe(false)
			expect(
				v.validate(modelCapabilitiesPipe, { inputs: ['text'], contextWindowTokens: 1, maxOutputTokens: 2, thinking: null }).valid,
			).toBe(false)
		})
	})
}
