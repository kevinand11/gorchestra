import { createOpenAI } from '@ai-sdk/openai'

import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelProvider } from '../../domain/model-provider'

export type OpenAIResponsesModelProviderProtocolProvider = ModelProviderProtocolProvider<'openai-responses'>

type OpenAIResponsesInput = Parameters<OpenAIResponsesModelProviderProtocolProvider['resolveLanguageModel']>[0]
type OpenAIProviderFactory = (input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) => {
	responses(modelId: string): AISDKLanguageModelResolution['languageModel']
}

export function createOpenAIResponsesModelProviderProtocolProvider(
	providerFactory: OpenAIProviderFactory = createOpenAIResponsesProvider,
): OpenAIResponsesModelProviderProtocolProvider {
	return {
		resolveLanguageModel(input) {
			return {
				ok: true,
				value: {
					languageModel: providerFactory(input).responses(input.model.providerModelId),
					providerOptions: openAIResponsesProviderOptions(),
				},
			}
		},
	}
}

function createOpenAIResponsesProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createOpenAI({
		apiKey: input.access.auth?.plaintext ?? 'unused',
		baseURL: input.modelProvider.baseUrl,
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function openAIResponsesProviderOptions(): AISDKLanguageModelResolution['providerOptions'] {
	return { openai: { store: false } }
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('OpenAI Responses AI SDK resolver', () => {
		it('uses Responses models and disables OpenAI response storage', () => {
			let modelId: string | null = null
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() => ({
				responses(id) {
					modelId = id
					return 'language-model'
				},
			}))

			const result = provider.resolveLanguageModel({ ...input(), thinking: { level: 'high' } })

			expect(result).toEqual({
				ok: true,
				value: {
					languageModel: 'language-model',
					providerOptions: { openai: { store: false } },
				},
			})
			expect(modelId).toBe('gpt-5')
		})
	})

	function input(): Extract<OpenAIResponsesInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'GPT 5',
				providerModelId: 'gpt-5',
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'OpenAI',
				protocol: { type: 'openai-responses' },
				baseUrl: 'https://api.openai.com/v1',
				auth: null,
				headers: [],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'high' },
		}
	}
}
