import type { AgentRunRuntimeError, ModelAgentTurnThinking } from './types'
import type { AgentRun } from '../../domain/agent-run'
import type { Model, ModelThinkingLevel } from '../../domain/model'
import { modelProviderProtocolForSource, type ModelProvider } from '../../domain/model-provider'
import type { ModelNotSelectableError, ModelThinkingLevelUnavailableError } from '../../errors'
import { validateModelThinkingLevelForUse } from '../../providers/model-provider-protocol/thinking'
import type { CoreStorage } from '../../services'
import { getRequired } from '../../storage/helpers'
import type { Result } from '../../utils/types'

export type TurnModelUse = {
	model: Model
	modelProvider: ModelProvider
	thinking: ModelAgentTurnThinking
}

export type TurnModelUseError = AgentRunRuntimeError | ModelThinkingLevelUnavailableError | ModelNotSelectableError

export async function loadTurnModelUse(storage: CoreStorage, agentRun: AgentRun): Promise<Result<TurnModelUse, TurnModelUseError>> {
	const modelUse = agentRun.modelUseOverride?.modelUse ?? agentRun.profile.modelUse
	const model = await getRequired('model', storage, modelUse.modelId)
	return model.ok ? loadTurnModelUseModel(storage, modelUse.thinkingLevel, model.value) : model
}

async function loadTurnModelUseModel(
	storage: CoreStorage,
	thinkingLevel: ModelThinkingLevel,
	model: Model,
): Promise<Result<TurnModelUse, TurnModelUseError>> {
	if (isArchived(model)) return { ok: false, error: { type: 'model-not-selectable', modelId: model.id, reason: 'model-archived' } }

	const provider = await getRequired('model-provider', storage, model.providerId)
	return provider.ok ? turnModelUseForProvider(thinkingLevel, model, provider.value) : provider
}

function turnModelUseForProvider(
	thinkingLevel: ModelThinkingLevel,
	model: Model,
	modelProvider: ModelProvider,
): Result<TurnModelUse, ModelThinkingLevelUnavailableError | ModelNotSelectableError> {
	if (isArchived(modelProvider))
		return { ok: false, error: { type: 'model-not-selectable', modelId: model.id, reason: 'provider-archived' } }

	const thinking = resolveProviderTurnThinking(model, modelProvider, thinkingLevel)
	return thinking.ok ? { ok: true, value: { model, modelProvider, thinking: thinking.value } } : thinking
}

function resolveProviderTurnThinking(
	model: Model,
	modelProvider: ModelProvider,
	thinkingLevel: ModelThinkingLevel,
): Result<ModelAgentTurnThinking, ModelThinkingLevelUnavailableError> {
	const validation = validateModelThinkingLevelForUse(model, modelProviderProtocolForSource(modelProvider.source), thinkingLevel)
	return validation.ok ? { ok: true, value: { level: thinkingLevel } } : validation
}

function isArchived(record: { archivePeriods: Array<{ unarchived: object | null }> }): boolean {
	return record.archivePeriods.at(-1)?.unarchived === null
}
