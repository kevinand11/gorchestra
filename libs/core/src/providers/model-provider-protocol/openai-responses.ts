import { createOpenAI } from '@ai-sdk/openai'

import type { AISDKLanguageModelResolution, ModelProviderProtocolAccess, ModelProviderProtocolProvider } from './types'
import type { ModelThinkingLevel } from '../../domain/model'
import type { ModelProvider } from '../../domain/model-provider'
import type { ModelAgentTurnThinking } from '../../runtime/agent-runs/types'

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
					providerOptions: openAIResponsesProviderOptions(input),
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

function openAIResponsesProviderOptions(input: OpenAIResponsesInput): AISDKLanguageModelResolution['providerOptions'] {
	return { openai: { store: false, ...openAIResponsesThinkingOptions(agentRunThinking(input)) } }
}

function agentRunThinking(input: OpenAIResponsesInput): ModelAgentTurnThinking {
	return input.mode === 'agent-run' ? input.thinking : null
}

function openAIResponsesThinkingOptions(thinking: ModelAgentTurnThinking): Record<string, string> {
	if (thinking === null) return {}
	if (thinking.level === 'off') return { reasoningEffort: 'none' }
	return { reasoningEffort: openAIReasoningEffort(thinking.level), reasoningSummary: 'auto' }
}

function openAIReasoningEffort(level: Exclude<ModelThinkingLevel, 'off'>): string {
	switch (level) {
		case 'minimal':
		case 'low':
		case 'medium':
		case 'high':
		case 'xhigh':
			return level
		default:
			throw new Error(`Unexpected Model Thinking Level: ${String(level satisfies never)}`)
	}
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
					providerOptions: { openai: { store: false, reasoningEffort: 'high', reasoningSummary: 'auto' } },
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
