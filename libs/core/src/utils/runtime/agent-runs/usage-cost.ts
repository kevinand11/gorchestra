import type { LanguageModelUsage } from 'ai'

import type { AgentRunLanguageModelUsage, AgentRunModelCost } from '../../../domain/agent-run-event'
import type { ModelTokenPricing } from '../../../domain/model'

export function usageFromAIUsage(usage: LanguageModelUsage): AgentRunLanguageModelUsage {
	return {
		inputTokens: usage.inputTokens ?? null,
		inputTokenDetails: {
			noCacheTokens: usage.inputTokenDetails.noCacheTokens ?? null,
			cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
			cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null,
		},
		outputTokens: usage.outputTokens ?? null,
		outputTokenDetails: {
			textTokens: usage.outputTokenDetails.textTokens ?? null,
			reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null,
		},
	}
}

export function costFromUsage(usage: AgentRunLanguageModelUsage, pricing: ModelTokenPricing | null): AgentRunModelCost | null {
	if (pricing === null) return null
	if (usage.inputTokenDetails.noCacheTokens === null || usage.outputTokens === null) return null
	const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0
	const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0
	return {
		unit: 'micro-usd',
		input: tokenCost(usage.inputTokenDetails.noCacheTokens, pricing.input),
		output: tokenCost(usage.outputTokens, pricing.output),
		cacheRead: tokenCost(cacheReadTokens, pricing.cacheRead),
		cacheWrite: tokenCost(cacheWriteTokens, pricing.cacheWrite),
	}
}

function tokenCost(tokens: number, priceMicroUsdPerMillion: number): number {
	if (tokens === 0 || priceMicroUsdPerMillion === 0) return 0
	return Math.round((tokens * priceMicroUsdPerMillion) / 1_000_000)
}
