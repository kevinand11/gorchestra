import { createAnthropic } from '@ai-sdk/anthropic'

import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelThinkingLevel } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type { ModelAgentTurnThinking } from '../../runtime/agent-runs/types'

export type AnthropicMessagesModelProviderProtocolProvider = ModelProviderProtocolProvider<'anthropic-messages'>

type AnthropicMessagesInput = Parameters<AnthropicMessagesModelProviderProtocolProvider['resolveLanguageModel']>[0]
type AnthropicProviderFactory = (input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) => {
	messages(modelId: string): AISDKLanguageModelResolution['languageModel']
}

export function createAnthropicMessagesModelProviderProtocolProvider(
	providerFactory: AnthropicProviderFactory = createAnthropicMessagesProvider,
): AnthropicMessagesModelProviderProtocolProvider {
	return {
		resolveLanguageModel(input) {
			return {
				ok: true,
				value: {
					languageModel: providerFactory(input).messages(input.model.providerModelId),
					providerOptions: anthropicProviderOptions(input),
				},
			}
		},
	}
}

function createAnthropicMessagesProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createAnthropic({
		apiKey: input.access.auth?.plaintext ?? '',
		baseURL: input.modelProvider.baseUrl,
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function anthropicProviderOptions(input: AnthropicMessagesInput): AISDKLanguageModelResolution['providerOptions'] {
	const thinking = input.mode === 'agent-run' ? input.thinking : null
	return thinking === null ? undefined : { anthropic: anthropicThinkingOptions(thinking) }
}

function anthropicThinkingOptions(
	thinking: ModelAgentTurnThinking,
): Record<string, NonNullable<AISDKLanguageModelResolution['providerOptions']>[string][string]> {
	if (thinking === null) return {}
	if (thinking.level === 'off') return { thinking: { type: 'disabled' } }
	return { thinking: { type: 'adaptive', display: 'summarized' }, effort: anthropicEffort(thinking.level) }
}

function anthropicEffort(level: Exclude<ModelThinkingLevel, 'off'>): string {
	switch (level) {
		case 'minimal':
		case 'low':
			return 'low'
		case 'medium':
			return 'medium'
		case 'high':
			return 'high'
		case 'xhigh':
			return 'max'
		default:
			throw new Error(`Unexpected Model Thinking Level: ${String(level satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Anthropic Messages AI SDK resolver', () => {
		it('resolves a messages model with summarized adaptive thinking', () => {
			let modelId: string | null = null
			const provider = createAnthropicMessagesModelProviderProtocolProvider(() => ({
				messages(id) {
					modelId = id
					return 'language-model'
				},
			}))

			const result = provider.resolveLanguageModel({ ...input(), thinking: { level: 'xhigh' } })

			expect(result).toEqual({
				ok: true,
				value: {
					languageModel: 'language-model',
					providerOptions: { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'max' } },
				},
			})
			expect(modelId).toBe('claude-sonnet-4-5')
		})
	})

	function input(): Extract<AnthropicMessagesInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'Claude Sonnet',
				providerModelId: 'claude-sonnet-4-5',
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'Anthropic',
				protocol: { type: 'anthropic-messages' },
				baseUrl: 'https://api.anthropic.com',
				auth: null,
				headers: [],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'xhigh' },
		}
	}
}
