import { createOpenAIModelReachabilityPreflight, type OpenAIModelReachabilityClientFactory } from './openai-model-reachability'
import type { ModelProviderProtocolProvider } from './types'

export type OpenAIResponsesModelProviderProtocolProvider = ModelProviderProtocolProvider<'openai-responses'>

export function createOpenAIResponsesModelProviderProtocolProvider(
	clientFactory?: OpenAIModelReachabilityClientFactory<'openai-responses'>,
): OpenAIResponsesModelProviderProtocolProvider {
	return { preflightModel: createOpenAIModelReachabilityPreflight(clientFactory) }
}
