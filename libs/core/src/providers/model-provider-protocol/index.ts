import {
	createAnthropicMessagesModelProviderProtocolProvider,
	type AnthropicMessagesModelProviderProtocolProvider,
} from './anthropic-messages'
import {
	createGoogleGenerativeAIModelProviderProtocolProvider,
	type GoogleGenerativeAIModelProviderProtocolProvider,
} from './google-generative-ai'
import {
	createOpenAICompletionsModelProviderProtocolProvider,
	type OpenAICompletionsModelProviderProtocolProvider,
} from './openai-completions'
import { createOpenAIResponsesModelProviderProtocolProvider, type OpenAIResponsesModelProviderProtocolProvider } from './openai-responses'

export interface ModelProviderProtocolProviders {
	anthropicMessages: AnthropicMessagesModelProviderProtocolProvider
	openAIResponses: OpenAIResponsesModelProviderProtocolProvider
	openAICompletions: OpenAICompletionsModelProviderProtocolProvider
	googleGenerativeAI: GoogleGenerativeAIModelProviderProtocolProvider
}

export function createModelProviderProtocolProviders(): ModelProviderProtocolProviders {
	return {
		anthropicMessages: createAnthropicMessagesModelProviderProtocolProvider(),
		openAIResponses: createOpenAIResponsesModelProviderProtocolProvider(),
		openAICompletions: createOpenAICompletionsModelProviderProtocolProvider(),
		googleGenerativeAI: createGoogleGenerativeAIModelProviderProtocolProvider(),
	}
}

export type {
	AnthropicMessagesModelProviderProtocolProvider,
	GoogleGenerativeAIModelProviderProtocolProvider,
	OpenAICompletionsModelProviderProtocolProvider,
	OpenAIResponsesModelProviderProtocolProvider,
}
