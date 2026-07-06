import { createGoogle } from '@ai-sdk/google'

import { resolveProviderOptions } from './options'
import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelProvider } from '../../domain/model-provider'

export type GoogleGenerativeAIModelProviderProtocolProvider = ModelProviderProtocolProvider<'google-generative-ai'>

type GoogleGenerativeAIInput = Parameters<GoogleGenerativeAIModelProviderProtocolProvider['resolveLanguageModel']>[0]
type GoogleProviderFactory = (input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) => {
	languageModel(modelId: string): AISDKLanguageModelResolution['languageModel']
}

export function createGoogleGenerativeAIModelProviderProtocolProvider(
	providerFactory: GoogleProviderFactory = createGoogleGenerativeAIProvider,
): GoogleGenerativeAIModelProviderProtocolProvider {
	return {
		resolveLanguageModel(input) {
			return {
				ok: true,
				value: {
					languageModel: providerFactory(input).languageModel(input.model.providerModelId),
					providerOptions: resolveProviderOptions('google', null, input.modelProvider, input.model),
				},
			}
		},
	}
}

function createGoogleGenerativeAIProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createGoogle({
		apiKey: input.access.auth?.plaintext ?? '',
		...baseUrlConfig(input.modelProvider),
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function baseUrlConfig(modelProvider: ModelProvider): { baseURL?: string } {
	switch (modelProvider.source.type) {
		case 'google':
			return {}
		case 'custom-hosted':
			return { baseURL: googleBaseURL(modelProvider.source.baseUrl) }
		case 'openai-responses':
		case 'anthropic':
		case 'groq':
			throw new Error(`Unexpected Google Generative AI source: ${modelProvider.source.type}`)
		default:
			throw new Error(`Unexpected Model Provider Source: ${String(modelProvider.source satisfies never)}`)
	}
}

function googleBaseURL(baseUrl: string): string {
	return baseUrl.endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Google Generative AI SDK resolver', () => {
		it('resolves language models and leaves thinking control to AI SDK reasoning', () => {
			let modelId: string | null = null
			const provider = createGoogleGenerativeAIModelProviderProtocolProvider(() => ({
				languageModel(id) {
					modelId = id
					return 'language-model'
				},
			}))

			const result = provider.resolveLanguageModel({ ...input(), thinking: { level: 'low' } })

			expect(result).toEqual({
				ok: true,
				value: { languageModel: 'language-model', providerOptions: undefined },
			})
			expect(modelId).toBe('gemini-2.5-pro')
		})

		it('uses v1beta base URL for custom-hosted Google-compatible sources', () => {
			let observedBaseUrl: string | null = null
			const provider = createGoogleGenerativeAIModelProviderProtocolProvider((input) => {
				observedBaseUrl = baseUrlConfig(input.modelProvider).baseURL ?? null
				return { languageModel: () => 'language-model' }
			})

			const result = provider.resolveLanguageModel({
				...input(),
				modelProvider: {
					...input().modelProvider,
					source: {
						type: 'custom-hosted',
						protocol: 'google-generative-ai',
						baseUrl: 'https://generativelanguage.googleapis.com',
					},
				},
			})

			expect(result).toMatchObject({ ok: true })
			expect(observedBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
		})
	})

	function input(): Extract<GoogleGenerativeAIInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			protocol: 'google-generative-ai',
			model: {
				id: '01k00000000000000000000024',
				providerId: '01k00000000000000000000027',
				name: 'Gemini Pro',
				providerModelId: 'gemini-2.5-pro',
				providerOptions: null,
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: '01k00000000000000000000027',
				name: 'Google',
				source: { type: 'google' },
				auth: null,
				headers: [],
				providerOptions: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'low' },
		}
	}
}
