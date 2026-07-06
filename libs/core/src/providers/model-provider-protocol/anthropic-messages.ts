import { createAnthropic } from '@ai-sdk/anthropic'

import { resolveProviderOptions } from './options'
import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelProvider } from '../../domain/model-provider'

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
					providerOptions: resolveProviderOptions('anthropic', null, input.modelProvider, input.model),
				},
			}
		},
	}
}

function createAnthropicMessagesProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createAnthropic({
		apiKey: input.access.auth?.plaintext ?? '',
		...baseUrlConfig(input.modelProvider),
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function baseUrlConfig(modelProvider: ModelProvider): { baseURL?: string } {
	switch (modelProvider.source.type) {
		case 'anthropic':
			return {}
		case 'custom-hosted':
			return { baseURL: modelProvider.source.baseUrl }
		case 'openai-responses':
		case 'google':
		case 'groq':
			throw new Error(`Unexpected Anthropic Messages source: ${modelProvider.source.type}`)
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(modelProvider.source satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Anthropic Messages AI SDK resolver', () => {
		it('resolves a messages model and leaves thinking control to AI SDK reasoning', () => {
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
				value: { languageModel: 'language-model', providerOptions: undefined },
			})
			expect(modelId).toBe('claude-sonnet-4-5')
		})
	})

	function input(): Extract<AnthropicMessagesInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			protocol: 'anthropic-messages',
			model: {
				id: '01k00000000000000000000024',
				providerId: '01k00000000000000000000027',
				name: 'Claude Sonnet',
				providerModelId: 'claude-sonnet-4-5',
				providerOptions: null,
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: '01k00000000000000000000027',
				name: 'Anthropic',
				source: { type: 'anthropic' },
				auth: null,
				headers: [],
				providerOptions: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'xhigh' },
		}
	}
}
