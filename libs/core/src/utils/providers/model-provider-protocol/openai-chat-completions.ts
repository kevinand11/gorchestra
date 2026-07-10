import { createGroq } from '@ai-sdk/groq'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import { resolveProviderOptions } from './options'
import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelProvider } from '../../../domain/model-provider'

export type OpenAIChatCompletionsModelProviderProtocolProvider = ModelProviderProtocolProvider<'openai-chat-completions'>

const customHostedOpenAICompatibleProviderName = 'gorchestraCustomHosted'

type OpenAIChatCompletionsInput = Parameters<OpenAIChatCompletionsModelProviderProtocolProvider['resolveLanguageModel']>[0]
type ChatCompletionsProviderFactory = (input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) => {
	languageModel(modelId: string): AISDKLanguageModelResolution['languageModel']
	namespace: string
}
export function createOpenAIChatCompletionsModelProviderProtocolProvider(
	providerFactory: ChatCompletionsProviderFactory = createChatCompletionsProvider,
): OpenAIChatCompletionsModelProviderProtocolProvider {
	return {
		resolveLanguageModel(input) {
			const provider = providerFactory(input)
			return {
				ok: true,
				value: {
					languageModel: provider.languageModel(input.model.providerModelId),
					providerOptions: resolveProviderOptions(provider.namespace, null, input.modelProvider, input.model),
				},
			}
		},
	}
}

function createChatCompletionsProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	switch (input.modelProvider.source.type) {
		case 'groq': {
			const groq = createGroq({
				apiKey: input.access.auth?.plaintext ?? '',
				headers: headers(input.access),
			})
			return { languageModel: (modelId: string) => groq(modelId), namespace: 'groq' }
		}
		case 'custom-hosted': {
			const provider = createOpenAICompatible({
				name: customHostedOpenAICompatibleProviderName,
				apiKey: input.access.auth?.plaintext ?? '',
				baseURL: input.modelProvider.source.baseUrl,
				headers: headers(input.access),
			})
			return { languageModel: (modelId: string) => provider(modelId), namespace: customHostedOpenAICompatibleProviderName }
		}
		case 'openai-responses':
		case 'anthropic':
		case 'google':
			throw new Error(`Unexpected OpenAI Chat Completions source: ${input.modelProvider.source.type}`)
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(input.modelProvider.source satisfies never)}`)
	}
}

function headers(access: ModelProviderProtocolAccess): Record<string, string> {
	return Object.fromEntries(access.headers.map((header) => [header.name, header.plaintext]))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../../domain/model')

	describe('OpenAI Chat Completions AI SDK resolver', () => {
		it('resolves built-in Groq chat models and wraps options under the groq namespace', () => {
			let modelId: string | null = null
			const provider = createOpenAIChatCompletionsModelProviderProtocolProvider(() => ({
				namespace: 'groq',
				languageModel(id) {
					modelId = id
					return 'language-model'
				},
			}))

			const result = provider.resolveLanguageModel({
				...input(),
				modelProvider: { ...input().modelProvider, providerOptions: { serviceTier: 'flex' } },
			})

			expect(result).toEqual({
				ok: true,
				value: { languageModel: 'language-model', providerOptions: { groq: { serviceTier: 'flex' } } },
			})
			expect(modelId).toBe('openai/gpt-oss-120b')
		})

		it('uses a stable namespace for custom-hosted OpenAI-compatible options', () => {
			const provider = createOpenAIChatCompletionsModelProviderProtocolProvider(() => ({
				namespace: customHostedOpenAICompatibleProviderName,
				languageModel: () => 'language-model',
			}))

			const result = provider.resolveLanguageModel({
				...input(),
				modelProvider: {
					...input().modelProvider,
					source: { type: 'custom-hosted', protocol: 'openai-chat-completions', baseUrl: 'https://api.example.com/v1' },
					providerOptions: { user: 'user-1' },
				},
			})

			expect(result).toMatchObject({
				ok: true,
				value: { providerOptions: { gorchestraCustomHosted: { user: 'user-1' } } },
			})
		})
	})

	function input(): Extract<OpenAIChatCompletionsInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			protocol: 'openai-chat-completions',
			model: {
				id: '01k00000000000000000000024',
				providerId: '01k00000000000000000000027',
				name: 'Groq GPT OSS 120B',
				providerModelId: 'openai/gpt-oss-120b',
				providerOptions: null,
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: '01k00000000000000000000027',
				name: 'Groq',
				source: { type: 'groq' },
				auth: null,
				headers: [],
				providerOptions: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'high' },
		}
	}
}
