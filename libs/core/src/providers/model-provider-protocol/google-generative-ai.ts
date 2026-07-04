import { createGoogle } from '@ai-sdk/google'

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
					providerOptions: undefined,
				},
			}
		},
	}
}

function createGoogleGenerativeAIProvider(input: { modelProvider: ModelProvider; access: ModelProviderProtocolAccess }) {
	return createGoogle({
		apiKey: input.access.auth?.plaintext ?? '',
		baseURL: googleBaseURL(input.modelProvider.baseUrl),
		headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

function googleBaseURL(baseUrl: string): string {
	return baseUrl.endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Google Generative AI SDK resolver', () => {
		it('resolves language models with v1beta base URL and leaves thinking control to AI SDK reasoning', () => {
			let modelId: string | null = null
			let observedBaseUrl: string | null = null
			const provider = createGoogleGenerativeAIModelProviderProtocolProvider((input) => {
				observedBaseUrl = googleBaseURL(input.modelProvider.baseUrl)
				return {
					languageModel(id) {
						modelId = id
						return 'language-model'
					},
				}
			})

			const result = provider.resolveLanguageModel({ ...input(), thinking: { level: 'low' } })

			expect(result).toEqual({
				ok: true,
				value: { languageModel: 'language-model', providerOptions: undefined },
			})
			expect(modelId).toBe('gemini-2.5-pro')
			expect(observedBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
		})
	})

	function input(): Extract<GoogleGenerativeAIInput, { mode: 'agent-run' }> {
		return {
			mode: 'agent-run',
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'Gemini Pro',
				providerModelId: 'gemini-2.5-pro',
				capabilities: defaultModelCapabilities,
				pricing: null,
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'Google',
				protocol: { type: 'google-generative-ai' },
				baseUrl: 'https://generativelanguage.googleapis.com',
				auth: null,
				headers: [],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: { auth: null, headers: [] },
			thinking: { level: 'low' },
		}
	}
}
