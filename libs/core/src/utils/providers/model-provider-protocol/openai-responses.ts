import { createOpenAI } from '@ai-sdk/openai'

import { resolveProviderOptions } from './options'
import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelProvider } from '../../../domain/model-provider'

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
					providerOptions: resolveProviderOptions('openai', { store: false }, input.modelProvider, input.model),
				},
			}
		},
	}
}

function createOpenAIResponsesProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createOpenAI({
		apiKey: input.access.auth?.plaintext ?? 'unused',
		...baseUrlConfig(input.modelProvider),
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function baseUrlConfig(modelProvider: ModelProvider): { baseURL?: string } {
	switch (modelProvider.source.type) {
		case 'openai-responses':
			return {}
		case 'custom-hosted':
			return { baseURL: modelProvider.source.baseUrl }
		case 'anthropic':
		case 'google':
		case 'groq':
			throw new Error(`Unexpected OpenAI Responses source: ${modelProvider.source.type}`)
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(modelProvider.source satisfies never)}`)
	}
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../../domain/model')

	describe('OpenAI Responses AI SDK resolver', () => {
		it('uses Responses models and disables OpenAI response storage by default', () => {
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

		it('lets explicit model provider options override OpenAI defaults', () => {
			const provider = createOpenAIResponsesModelProviderProtocolProvider(() => ({ responses: () => 'language-model' }))

			const result = provider.resolveLanguageModel({
				...input(),
				modelProvider: { ...input().modelProvider, providerOptions: { store: true, reasoningSummary: 'auto' } },
			})

			expect(result).toMatchObject({
				ok: true,
				value: { providerOptions: { openai: { store: true, reasoningSummary: 'auto' } } },
			})
		})
	})

	function input(): Extract<OpenAIResponsesInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			protocol: 'openai-responses',
			model: {
				id: '01k00000000000000000000024',
				providerId: '01k00000000000000000000027',
				name: 'GPT 5',
				providerModelId: 'gpt-5',
				providerOptions: null,
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: '01k00000000000000000000027',
				name: 'OpenAI',
				source: { type: 'openai-responses' },
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
