import type { Id } from '../../domain/commons'
import type { Model } from '../../domain/model'
import type { ModelProvider, ModelProviderProtocol } from '../../domain/model-provider'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { Result } from '../../utils/types'

export interface ModelProviderProtocolPreflightModelInput {
	model: Model
	modelProvider: ModelProvider
}

export type ModelProviderProtocolPreflightFailureReason =
	| { type: 'model-archived'; modelId: Id }
	| { type: 'model-provider-archived'; modelProviderId: Id }
	| { type: 'model-provider-auth-secret-missing'; secretId: Id }
	| { type: 'model-provider-auth-secret-inactive'; secretId: Id }
	| { type: 'model-provider-header-secret-missing'; secretId: Id; headerName: string }
	| { type: 'model-provider-header-secret-inactive'; secretId: Id; headerName: string }
	| { type: 'model-provider-secret-unresolved'; secretId: Id }
	| { type: 'provider-authentication-failed' }
	| { type: 'provider-access-denied' }
	| { type: 'provider-model-not-found' }
	| { type: 'provider-unavailable' }
	| { type: 'provider-preflight-not-implemented' }

export type ModelProviderProtocolPreflight =
	| { type: 'passed'; summary: string }
	| { type: 'failed'; reason: ModelProviderProtocolPreflightFailureReason; summary: string }

export type ModelProviderProtocolPreflightError = InvalidCoreServiceOutputError

export interface ModelProviderProtocolProviders {
	preflightModel(
		input: ModelProviderProtocolPreflightModelInput,
	): Promise<Result<ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>>
}

export interface ModelProviderProtocolAccess {
	auth: { type: 'apiKey'; plaintext: string } | null
	headers: Array<{ name: string; plaintext: string }>
}

export interface ModelProviderProtocolProviderPreflightModelInput<Protocol extends ModelProviderProtocol> {
	model: Model
	modelProvider: ModelProvider & { protocol: Protocol }
	access: ModelProviderProtocolAccess
}

export type ModelProviderProtocolProviderPreflight =
	| { type: 'passed' }
	| {
			type: 'failed'
			reason: Extract<
				ModelProviderProtocolPreflightFailureReason,
				| { type: 'provider-authentication-failed' }
				| { type: 'provider-access-denied' }
				| { type: 'provider-model-not-found' }
				| { type: 'provider-unavailable' }
				| { type: 'provider-preflight-not-implemented' }
			>
	  }

export interface ModelProviderProtocolProvider<Protocol extends ModelProviderProtocol> {
	preflightModel(input: ModelProviderProtocolProviderPreflightModelInput<Protocol>): Promise<ModelProviderProtocolProviderPreflight>
}
