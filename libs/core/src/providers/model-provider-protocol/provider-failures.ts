import type { ModelProviderGenerationFailureReason } from '../../domain/agent-run'

export function providerFailureReason(error: unknown): ModelProviderGenerationFailureReason {
	switch (statusCode(error)) {
		case 401:
			return { type: 'provider-authentication-failed' }
		case 403:
			return { type: 'provider-access-denied' }
		case 404:
			return { type: 'provider-model-not-found' }
		case 429:
			return { type: 'provider-rate-limited' }
		case 400:
			return { type: 'provider-generation-failed' }
		case 408:
		case 409:
		case 500:
		case 502:
		case 503:
		case 504:
			return { type: 'provider-unavailable' }
		default:
			return { type: 'provider-generation-failed' }
	}
}

export function safeProviderErrorSummary(reason: ModelProviderGenerationFailureReason): string {
	switch (reason.type) {
		case 'provider-authentication-failed':
			return 'Provider authentication failed.'
		case 'provider-access-denied':
			return 'Provider access was denied.'
		case 'provider-model-not-found':
			return 'Provider model was not found.'
		case 'provider-rate-limited':
			return 'Provider rate limit was reached.'
		case 'provider-content-filtered':
			return 'Provider content filter blocked generation.'
		case 'provider-unavailable':
			return 'Provider was unavailable.'
		case 'provider-generation-failed':
			return 'Provider generation failed.'
		default:
			throw new Error(`Unexpected provider generation failure reason: ${String(reason satisfies never)}`)
	}
}

function statusCode(error: unknown): number | null {
	const status = typeof error === 'object' && error !== null ? (error as { status?: unknown; statusCode?: unknown }).status : null
	if (typeof status === 'number') return status

	const statusCodeValue = typeof error === 'object' && error !== null ? (error as { statusCode?: unknown }).statusCode : null
	return typeof statusCodeValue === 'number' ? statusCodeValue : null
}
