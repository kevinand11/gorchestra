import { isArchived } from '../commands/utils/storage'
import { defaultModelCapabilities, type ListedModel, type Model } from '../domain/model'
import {
	modelProviderProtocolForSource,
	type ListedModelProvider,
	type ModelProvider,
	type ModelProviderSummary,
} from '../domain/model-provider'
import { availableThinkingLevelsForModel, configurableThinkingLevelsForProtocol } from '../providers/model-provider-protocol/thinking'

export function listedModelProviders(modelProviders: ModelProvider[], models: Model[]): ListedModelProvider[] {
	const modelsByProviderId = groupModelsByProviderId(models)

	return modelProviders.map((provider) => {
		const { archivePeriods, ...providerFields } = provider
		const protocol = modelProviderProtocolForSource(provider.source)
		const providerModels = (modelsByProviderId.get(provider.id) ?? []).map((model) => listedModel(model, provider))
		return {
			...providerFields,
			protocol,
			archived: isArchived(archivePeriods),
			configurableThinkingLevels: configurableThinkingLevelsForProtocol(protocol),
			models: providerModels,
		}
	})
}

export function listedModel(model: Model, provider: ModelProvider): ListedModel {
	const { archivePeriods, ...modelFields } = model
	const protocol = modelProviderProtocolForSource(provider.source)
	return {
		...modelFields,
		archived: isArchived(archivePeriods),
		availableThinkingLevels: availableThinkingLevelsForModel(model, protocol),
	}
}

export function modelProviderSummary(provider: ModelProvider): ModelProviderSummary {
	const protocol = modelProviderProtocolForSource(provider.source)
	return {
		id: provider.id,
		name: provider.name,
		source: provider.source,
		protocol,
		archived: isArchived(provider.archivePeriods),
		configurableThinkingLevels: configurableThinkingLevelsForProtocol(protocol),
	}
}

function groupModelsByProviderId(models: Model[]): Map<string, Model[]> {
	const grouped = new Map<string, Model[]>()
	for (const model of models) {
		const providerModels = grouped.get(model.providerId) ?? []
		providerModels.push(model)
		grouped.set(model.providerId, providerModels)
	}
	return grouped
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { stamp } = await import('../utils/test-helpers')

	describe('listedModelProviders', () => {
		it('groups Models under Providers while preserving caller order with archive state and thinking levels', () => {
			const providerA = modelProvider({ id: '01k00000000000000000100052', createdAt: '2026-06-09T00:00:00.000Z', archived: true })
			const providerB = modelProvider({ id: '01k00000000000000000100053', createdAt: '2026-06-10T00:00:00.000Z' })
			const modelA = model({
				id: '01k00000000000000000100045',
				providerId: '01k00000000000000000100052',
				createdAt: '2026-06-09T00:00:00.000Z',
			})
			const modelB = model({
				id: '01k00000000000000000100046',
				providerId: '01k00000000000000000100052',
				createdAt: '2026-06-10T00:00:00.000Z',
				archived: true,
				thinking: { supportedLevels: ['low', 'high'] },
			})
			const modelC = model({
				id: '01k00000000000000000100047',
				providerId: '01k00000000000000000100055',
				createdAt: '2026-06-11T00:00:00.000Z',
			})

			expect(listedModelProviders([providerB, providerA], [modelB, modelC, modelA])).toEqual([
				{
					...listedProvider(providerB, false),
					protocol: 'openai-responses',
					configurableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
					models: [],
				},
				{
					...listedProvider(providerA, true),
					protocol: 'openai-responses',
					configurableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
					models: [listedModelRecord(modelB, true, ['none', 'low', 'high']), listedModelRecord(modelA, false)],
				},
			])
		})
	})

	function modelProvider(input: { id: string; createdAt: string; archived?: boolean }): ModelProvider {
		return {
			id: input.id,
			name: input.id,
			source: { type: 'openai-responses' },
			auth: null,
			headers: [],
			providerOptions: null,
			created: { origin: 'imported', at: input.createdAt },
			updated: null,
			archivePeriods: input.archived === true ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function model(input: {
		id: string
		providerId: string
		createdAt: string
		archived?: boolean
		thinking?: Model['capabilities']['thinking']
	}): Model {
		return {
			id: input.id,
			providerId: input.providerId,
			name: input.id,
			providerModelId: input.id,
			providerOptions: null,
			capabilities: { ...defaultModelCapabilities, thinking: input.thinking ?? null },
			pricing: null,
			created: { origin: 'imported', at: input.createdAt },
			updated: null,
			archivePeriods: input.archived === true ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function listedProvider(
		provider: ModelProvider,
		archived: boolean,
	): Omit<ListedModelProvider, 'configurableThinkingLevels' | 'models' | 'protocol'> {
		const { archivePeriods: _archivePeriods, ...providerFields } = provider
		return { ...providerFields, archived }
	}

	function listedModelRecord(
		modelRecord: Model,
		archived: boolean,
		availableThinkingLevels: ListedModel['availableThinkingLevels'] = ['none'],
	): ListedModel {
		const { archivePeriods: _archivePeriods, ...modelFields } = modelRecord
		return { ...modelFields, archived, availableThinkingLevels }
	}
}
