import Anthropic from '@anthropic-ai/sdk'

import { providerFailurePreflight } from './provider-failures'
import type { ModelProviderProtocolProvider, ModelProviderProtocolProviderPreflightModelInput } from './types'

type AnthropicMessagesPreflightInput = ModelProviderProtocolProviderPreflightModelInput<'anthropic-messages'>

type AnthropicMessagesClient = {
	models: {
		retrieve(modelID: string): Promise<unknown>
	}
}

type AnthropicMessagesClientFactory = (input: AnthropicMessagesPreflightInput) => AnthropicMessagesClient

export type AnthropicMessagesModelProviderProtocolProvider = ModelProviderProtocolProvider<'anthropic-messages'>

export function createAnthropicMessagesModelProviderProtocolProvider(
	clientFactory: AnthropicMessagesClientFactory = createAnthropicMessagesClient,
): AnthropicMessagesModelProviderProtocolProvider {
	return {
		async preflightModel(input) {
			try {
				await clientFactory(input).models.retrieve(input.model.providerModelId)
				return { type: 'passed' }
			} catch (error) {
				return providerFailurePreflight(error)
			}
		},
	}
}

function createAnthropicMessagesClient(input: AnthropicMessagesPreflightInput): AnthropicMessagesClient {
	return new Anthropic({
		apiKey: input.access.auth?.plaintext ?? '',
		baseURL: input.modelProvider.baseUrl,
		defaultHeaders: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('Anthropic Messages Model Provider Protocol provider', () => {
		it('retrieves provider model metadata with configured access', async () => {
			let observed: AnthropicMessagesPreflightInput | null = null
			let retrievedModel: string | null = null
			const provider = createAnthropicMessagesModelProviderProtocolProvider((input) => {
				observed = input
				return {
					models: {
						retrieve(model) {
							retrievedModel = model
							return Promise.resolve({ id: model })
						},
					},
				}
			})

			const result = await provider.preflightModel(anthropicMessagesInput())

			expect(result).toEqual({ type: 'passed' })
			expect(retrievedModel).toBe('claude-sonnet-4-5')
			expect(observed).toMatchObject({
				access: {
					auth: { type: 'apiKey', plaintext: 'token' },
					headers: [{ name: 'anthropic-beta', plaintext: 'beta-flag' }],
				},
				modelProvider: { baseUrl: 'https://api.anthropic.com' },
			})
		})

		it.each([
			[401, 'provider-authentication-failed'],
			[403, 'provider-access-denied'],
			[404, 'provider-model-not-found'],
			[500, 'provider-unavailable'],
		])('maps status %s to %s', async (status, reason) => {
			const provider = createAnthropicMessagesModelProviderProtocolProvider(() => ({
				models: {
					retrieve() {
						return Promise.reject(errorWithStatus(status))
					},
				},
			}))

			const result = await provider.preflightModel(anthropicMessagesInput())

			expect(result).toEqual({ type: 'failed', reason: { type: reason } })
		})
	})

	function errorWithStatus(status: number): Error {
		return Object.assign(new Error('Anthropic request failed.'), { status })
	}

	function anthropicMessagesInput(): AnthropicMessagesPreflightInput {
		return {
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'Claude Sonnet',
				providerModelId: 'claude-sonnet-4-5',
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'Anthropic',
				protocol: 'anthropic-messages',
				baseUrl: 'https://api.anthropic.com',
				auth: { type: 'apiKey', secretId: 'secret-1' },
				headers: [{ name: 'anthropic-beta', valueSecretId: 'secret-2' }],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: {
				auth: { type: 'apiKey', plaintext: 'token' },
				headers: [{ name: 'anthropic-beta', plaintext: 'beta-flag' }],
			},
		}
	}
}
