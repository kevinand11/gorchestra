import { GoogleGenAI } from '@google/genai'

import { providerFailurePreflight } from './provider-failures'
import type { ModelProviderProtocolProvider, ModelProviderProtocolProviderPreflightModelInput } from './types'

type GoogleGenerativeAIPreflightInput = ModelProviderProtocolProviderPreflightModelInput<'google-generative-ai'>

type GoogleGenerativeAIClient = {
	models: {
		get(input: { model: string }): Promise<unknown>
	}
}

type GoogleGenerativeAIClientFactory = (input: GoogleGenerativeAIPreflightInput) => GoogleGenerativeAIClient

export type GoogleGenerativeAIModelProviderProtocolProvider = ModelProviderProtocolProvider<'google-generative-ai'>

export function createGoogleGenerativeAIModelProviderProtocolProvider(
	clientFactory: GoogleGenerativeAIClientFactory = createGoogleGenerativeAIClient,
): GoogleGenerativeAIModelProviderProtocolProvider {
	return {
		async preflightModel(input) {
			try {
				await clientFactory(input).models.get({ model: input.model.providerModelId })
				return { type: 'passed' }
			} catch (error) {
				return providerFailurePreflight(error)
			}
		},
	}
}

function createGoogleGenerativeAIClient(input: GoogleGenerativeAIPreflightInput): GoogleGenerativeAIClient {
	return new GoogleGenAI({
		apiKey: input.access.auth?.plaintext ?? '',
		httpOptions: {
			baseUrl: input.modelProvider.baseUrl,
			headers: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
		},
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { defaultModelCapabilities } = await import('../../domain/model')

	describe('Google Generative AI Model Provider Protocol provider', () => {
		it('gets provider model metadata with configured access', async () => {
			let observed: GoogleGenerativeAIPreflightInput | null = null
			let retrievedModel: string | null = null
			const provider = createGoogleGenerativeAIModelProviderProtocolProvider((input) => {
				observed = input
				return {
					models: {
						get({ model }) {
							retrievedModel = model
							return Promise.resolve({ name: model })
						},
					},
				}
			})

			const result = await provider.preflightModel(googleGenerativeAIInput())

			expect(result).toEqual({ type: 'passed' })
			expect(retrievedModel).toBe('gemini-2.5-pro')
			expect(observed).toMatchObject({
				access: {
					auth: { type: 'apiKey', plaintext: 'token' },
					headers: [{ name: 'X-Goog-User-Project', plaintext: 'project-1' }],
				},
				modelProvider: { baseUrl: 'https://generativelanguage.googleapis.com' },
			})
		})

		it.each([
			[401, 'provider-authentication-failed'],
			[403, 'provider-access-denied'],
			[404, 'provider-model-not-found'],
			[500, 'provider-unavailable'],
		])('maps status %s to %s', async (status, reason) => {
			const provider = createGoogleGenerativeAIModelProviderProtocolProvider(() => ({
				models: {
					get() {
						return Promise.reject(errorWithStatus(status))
					},
				},
			}))

			const result = await provider.preflightModel(googleGenerativeAIInput())

			expect(result).toEqual({ type: 'failed', reason: { type: reason } })
		})
	})

	function errorWithStatus(status: number): Error {
		return Object.assign(new Error('Google Generative AI request failed.'), { status })
	}

	function googleGenerativeAIInput(): GoogleGenerativeAIPreflightInput {
		return {
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
				auth: { type: 'apiKey', secretId: 'secret-1' },
				headers: [{ name: 'X-Goog-User-Project', valueSecretId: 'secret-2' }],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: {
				auth: { type: 'apiKey', plaintext: 'token' },
				headers: [{ name: 'X-Goog-User-Project', plaintext: 'project-1' }],
			},
		}
	}
}
