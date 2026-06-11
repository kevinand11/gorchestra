import type { ModelProviderProtocolProviderPreflight } from './types'

type ModelProviderProtocolProviderFailureReason = Extract<ModelProviderProtocolProviderPreflight, { type: 'failed' }>['reason']

export function providerFailurePreflight(error: unknown): ModelProviderProtocolProviderPreflight {
	return { type: 'failed', reason: providerFailureReason(error) }
}

function providerFailureReason(error: unknown): ModelProviderProtocolProviderFailureReason {
	switch (statusCode(error)) {
		case 401:
			return { type: 'provider-authentication-failed' }
		case 403:
			return { type: 'provider-access-denied' }
		case 404:
			return { type: 'provider-model-not-found' }
		default:
			return { type: 'provider-unavailable' }
	}
}

function statusCode(error: unknown): number | null {
	const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null
	return typeof status === 'number' ? status : null
}
