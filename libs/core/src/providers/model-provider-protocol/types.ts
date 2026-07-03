import type { JSONValue, LanguageModel } from 'ai'

import type { AgentRunModelMessageOutcome, ModelProviderGenerationFailureReason } from '../../domain/agent-run'
import type { Id } from '../../domain/commons'
import type { Model } from '../../domain/model'
import type { ModelProvider, ModelProviderProtocolType } from '../../domain/model-provider'
import type { InvalidCoreServiceOutputError, ModelThinkingLevelUnavailableError, StorageOperationFailedError } from '../../errors'
import type { ModelAgentTurnThinking } from '../../runtime/agent-runs/types'
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
	| ModelThinkingLevelUnavailableError
	| ModelProviderGenerationFailureReason

export type ModelProviderProtocolPreflight =
	| { type: 'passed'; summary: string }
	| { type: 'failed'; reason: ModelProviderProtocolPreflightFailureReason; summary: string }

export type ModelProviderProtocolPreflightError = InvalidCoreServiceOutputError

export interface ModelProviderProtocolAccess {
	auth: { type: 'apiKey'; plaintext: string } | null
	headers: Array<{ name: string; plaintext: string }>
}

export type AISDKLanguageModelResolutionInput =
	| {
			mode: 'preflight'
			model: Model
			modelProvider: ModelProvider
			access: ModelProviderProtocolAccess
	  }
	| {
			mode: 'agent-run'
			model: Model
			modelProvider: ModelProvider
			access: ModelProviderProtocolAccess
			thinking: ModelAgentTurnThinking
	  }

export interface AISDKLanguageModelResolution {
	languageModel: LanguageModel
	providerOptions: Record<string, Record<string, JSONValue>> | undefined
}

export type ResolveAISDKLanguageModelError = ModelThinkingLevelUnavailableError

export type ModelAgentTurnAccessError = InvalidCoreServiceOutputError | StorageOperationFailedError

export interface ModelProviderProtocolProviders {
	preflightModel(
		input: ModelProviderProtocolPreflightModelInput,
	): Promise<Result<ModelProviderProtocolPreflight, ModelProviderProtocolPreflightError>>
	resolveLanguageModel(
		input: Omit<Extract<AISDKLanguageModelResolutionInput, { mode: 'agent-run' }>, 'access'>,
	): Promise<
		Result<AISDKLanguageModelResolution | AgentRunModelMessageOutcome, ResolveAISDKLanguageModelError | ModelAgentTurnAccessError>
	>
}

export type ModelProviderProtocolProviderResolveInput<Protocol extends ModelProviderProtocolType> = AISDKLanguageModelResolutionInput & {
	modelProvider: ModelProvider & { protocol: { type: Protocol } }
}

export interface ModelProviderProtocolProvider<Protocol extends ModelProviderProtocolType> {
	resolveLanguageModel(
		input: ModelProviderProtocolProviderResolveInput<Protocol>,
	): Result<AISDKLanguageModelResolution, ResolveAISDKLanguageModelError>
}
