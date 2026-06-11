import { createOpenAIModelReachabilityPreflight, type OpenAIModelReachabilityClientFactory } from './openai-model-reachability'
import type { ModelProviderProtocolProvider } from './types'

export type OpenAICompletionsModelProviderProtocolProvider = ModelProviderProtocolProvider<'openai-completions'>

export function createOpenAICompletionsModelProviderProtocolProvider(
	clientFactory?: OpenAIModelReachabilityClientFactory<'openai-completions'>,
): OpenAICompletionsModelProviderProtocolProvider {
	return { preflightModel: createOpenAIModelReachabilityPreflight(clientFactory) }
}
