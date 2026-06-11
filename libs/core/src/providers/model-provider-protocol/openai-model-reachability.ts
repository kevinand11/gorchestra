import OpenAI from 'openai'

import { providerFailurePreflight } from './provider-failures'
import type { ModelProviderProtocolProviderPreflight, ModelProviderProtocolProviderPreflightModelInput } from './types'

type OpenAIModelReachabilityProtocol = 'openai-completions' | 'openai-responses'

export type OpenAIModelReachabilityInput<Protocol extends OpenAIModelReachabilityProtocol> =
	ModelProviderProtocolProviderPreflightModelInput<Protocol>

export type OpenAIModelReachabilityClient = {
	models: {
		retrieve(model: string): Promise<unknown>
	}
}

export type OpenAIModelReachabilityClientFactory<Protocol extends OpenAIModelReachabilityProtocol> = (
	input: OpenAIModelReachabilityInput<Protocol>,
) => OpenAIModelReachabilityClient

export function createOpenAIModelReachabilityPreflight<Protocol extends OpenAIModelReachabilityProtocol>(
	clientFactory: OpenAIModelReachabilityClientFactory<Protocol> = createOpenAIModelReachabilityClient,
): (input: OpenAIModelReachabilityInput<Protocol>) => Promise<ModelProviderProtocolProviderPreflight> {
	return async (input) => {
		try {
			await clientFactory(input).models.retrieve(input.model.providerModelId)
			return { type: 'passed' }
		} catch (error) {
			return providerFailurePreflight(error)
		}
	}
}

function createOpenAIModelReachabilityClient<Protocol extends OpenAIModelReachabilityProtocol>(
	input: OpenAIModelReachabilityInput<Protocol>,
): OpenAIModelReachabilityClient {
	return new OpenAI({
		apiKey: input.access.auth?.plaintext ?? '',
		baseURL: input.modelProvider.baseUrl,
		defaultHeaders: Object.fromEntries(input.access.headers.map((header) => [header.name, header.plaintext])),
	})
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('OpenAI model reachability preflight', () => {
		it('retrieves provider model metadata with configured access', async () => {
			let observed: OpenAIModelReachabilityInput<'openai-responses'> | null = null
			let retrievedModel: string | null = null
			const preflight = createOpenAIModelReachabilityPreflight<'openai-responses'>((input) => {
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

			const result = await preflight(openAIReachabilityInput('openai-responses'))

			expect(result).toEqual({ type: 'passed' })
			expect(retrievedModel).toBe('gpt-5')
			expect(observed).toMatchObject({
				access: {
					auth: { type: 'apiKey', plaintext: 'token' },
					headers: [{ name: 'OpenAI-Organization', plaintext: 'org-1' }],
				},
				modelProvider: { baseUrl: 'https://api.openai.com/v1' },
			})
		})

		it.each([
			[401, 'provider-authentication-failed'],
			[403, 'provider-access-denied'],
			[404, 'provider-model-not-found'],
			[500, 'provider-unavailable'],
		])('maps status %s to %s', async (status, reason) => {
			const preflight = createOpenAIModelReachabilityPreflight<'openai-completions'>(() => ({
				models: {
					retrieve() {
						return Promise.reject(errorWithStatus(status))
					},
				},
			}))

			const result = await preflight(openAIReachabilityInput('openai-completions'))

			expect(result).toEqual({ type: 'failed', reason: { type: reason } })
		})
	})

	function errorWithStatus(status: number): Error {
		return Object.assign(new Error('OpenAI request failed.'), { status })
	}

	function openAIReachabilityInput<Protocol extends OpenAIModelReachabilityProtocol>(
		protocol: Protocol,
	): OpenAIModelReachabilityInput<Protocol> {
		return {
			model: {
				id: 'model-1',
				providerId: 'model-provider-1',
				name: 'GPT 5',
				providerModelId: 'gpt-5',
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			modelProvider: {
				id: 'model-provider-1',
				name: 'OpenAI',
				protocol,
				baseUrl: 'https://api.openai.com/v1',
				auth: { type: 'apiKey', secretId: 'secret-1' },
				headers: [{ name: 'OpenAI-Organization', valueSecretId: 'secret-2' }],
				created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
				updated: null,
				archivePeriods: [],
			},
			access: {
				auth: { type: 'apiKey', plaintext: 'token' },
				headers: [{ name: 'OpenAI-Organization', plaintext: 'org-1' }],
			},
		}
	}
}
