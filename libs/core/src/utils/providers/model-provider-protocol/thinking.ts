import type { Id } from '../../../domain/commons'
import {
	modelConfiguredThinkingLevels,
	positiveModelThinkingLevels,
	type Model,
	type ModelThinkingLevel,
	type PositiveModelThinkingLevel,
} from '../../../domain/model'
import type { ModelProviderProtocol } from '../../../domain/model-provider'
import type { ModelThinkingLevelUnavailableError } from '../../../errors'
import type { Result } from '../../types'

export function configurableThinkingLevelsForProtocol(protocol: ModelProviderProtocol): PositiveModelThinkingLevel[] {
	switch (protocol) {
		case 'anthropic-messages':
		case 'openai-responses':
		case 'openai-chat-completions':
			return [...positiveModelThinkingLevels]
		case 'google-generative-ai':
			return positiveModelThinkingLevels.filter((level) => level !== 'xhigh')
		default:
			throw new Error(`Unexpected Model Provider Protocol: ${String(protocol satisfies never)}`)
	}
}

export function availableThinkingLevelsForModel(model: Model, protocol: ModelProviderProtocol): ModelThinkingLevel[] {
	const configurableLevels = configurableThinkingLevelsForProtocol(protocol)
	const supportedLevels = modelConfiguredThinkingLevels(model.capabilities).filter((level) => configurableLevels.includes(level))
	return ['none', ...supportedLevels]
}

export function validateModelThinkingCapabilityForProtocol(
	model: Model,
	protocol: ModelProviderProtocol,
): Result<void, ModelThinkingLevelUnavailableError> {
	const configurableLevels = configurableThinkingLevelsForProtocol(protocol)
	const unsupportedLevel = modelConfiguredThinkingLevels(model.capabilities).find((level) => !configurableLevels.includes(level))

	return unsupportedLevel === undefined
		? { ok: true, value: undefined }
		: modelThinkingLevelUnavailable(model.id, unsupportedLevel, {
				type: 'provider-thinking-level-unsupported',
				protocol,
			})
}

export function validateModelThinkingLevelForUse(
	model: Model,
	protocol: ModelProviderProtocol,
	thinkingLevel: ModelThinkingLevel,
): Result<void, ModelThinkingLevelUnavailableError> {
	if (thinkingLevel === 'none') return { ok: true, value: undefined }

	const capabilityValidation = validateModelThinkingCapabilityForProtocol(model, protocol)
	if (!capabilityValidation.ok) return capabilityValidation

	return model.capabilities.thinking?.supportedLevels.includes(thinkingLevel) === true
		? { ok: true, value: undefined }
		: modelThinkingLevelUnavailable(model.id, thinkingLevel, thinkingLevelUnavailableReason(model, protocol, thinkingLevel))
}

function thinkingLevelUnavailableReason(
	model: Model,
	protocol: ModelProviderProtocol,
	thinkingLevel: PositiveModelThinkingLevel,
): ModelThinkingLevelUnavailableError['reason'] {
	if (model.capabilities.thinking === null) return { type: 'model-thinking-unconfigured' }
	if (!model.capabilities.thinking.supportedLevels.includes(thinkingLevel)) return { type: 'thinking-level-unconfigured' }
	return { type: 'provider-thinking-level-unsupported', protocol }
}

function modelThinkingLevelUnavailable(
	modelId: Id,
	thinkingLevel: ModelThinkingLevel,
	reason: ModelThinkingLevelUnavailableError['reason'],
): Result<never, ModelThinkingLevelUnavailableError> {
	return { ok: false, error: { type: 'model-thinking-level-unavailable', modelId, thinkingLevel, reason } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../../domain/model')

	describe('Model Provider Protocol thinking support', () => {
		it('derives Model thinking levels from implicit none, configured support, and protocol support', () => {
			expect(
				availableThinkingLevelsForModel(model({ thinking: { supportedLevels: ['low', 'xhigh'] } }), 'google-generative-ai'),
			).toEqual(['none', 'low'])
			expect(
				availableThinkingLevelsForModel(model({ thinking: { supportedLevels: ['minimal', 'xhigh'] } }), 'openai-chat-completions'),
			).toEqual(['none', 'minimal', 'xhigh'])
		})

		it('rejects configured thinking support that the provider protocol cannot map', () => {
			expect(
				validateModelThinkingCapabilityForProtocol(model({ thinking: { supportedLevels: ['xhigh'] } }), 'google-generative-ai'),
			).toEqual({
				ok: false,
				error: {
					type: 'model-thinking-level-unavailable',
					modelId: '01k00000000000000000000024',
					thinkingLevel: 'xhigh',
					reason: { type: 'provider-thinking-level-unsupported', protocol: 'google-generative-ai' },
				},
			})
		})
	})

	function model(input: Pick<Model['capabilities'], 'thinking'>): Model {
		return {
			id: '01k00000000000000000000024',
			providerId: '01k00000000000000000000027',
			name: 'Model',
			providerModelId: 'provider-model',
			providerOptions: null,
			capabilities: { ...defaultModelCapabilities, thinking: input.thinking },
			pricing: null,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archivePeriods: [],
		}
	}
}
