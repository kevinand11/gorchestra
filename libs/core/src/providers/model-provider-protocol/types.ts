import type { AgentRunModelMessageOutcome } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { Model } from '../../domain/model'
import type { ModelProvider, ModelProviderProtocol } from '../../domain/model-provider'
import type { InvalidCoreServiceOutputError } from '../../errors'
import type { AgentRunModelDelta } from '../../runtime/agent-runs/live-events'
import type { AgentRunProviderMessage, AgentRunProviderTool } from '../../runtime/agent-runs/types'
import type { ResolvableSecretValue } from '../../services'
import type { Result } from '../../utils/types'

export interface ModelProviderProtocolPreflightModelInput {
	model: Model
	modelProvider: ModelProvider
	secrets: ResolvableSecretValue[]
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

export interface ModelAgentTurnInput {
	model: Model
	modelProvider: ModelProvider
	messages: AgentRunProviderMessage[]
	tools: AgentRunProviderTool[]
	signal: AbortSignal
	onDelta(delta: AgentRunModelDelta): void
}

export interface ModelAgentTurnOutput {
	outcome: AgentRunModelMessageOutcome
}

export type ModelAgentTurnError = InvalidCoreServiceOutputError

export interface ModelProviderProtocolProviders {
	preflightModel(
		input: ModelProviderProtocolPreflightModelInput,
	): Promise<Result<ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>>
	runModelAgentTurn(input: ModelAgentTurnInput): Promise<Result<ModelAgentTurnOutput, ModelAgentTurnError>>
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

export interface ModelProviderProtocolProviderModelAgentTurnInput<Protocol extends ModelProviderProtocol> extends ModelAgentTurnInput {
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
	runModelAgentTurn?(input: ModelProviderProtocolProviderModelAgentTurnInput<Protocol>): Promise<ModelAgentTurnOutput>
}
