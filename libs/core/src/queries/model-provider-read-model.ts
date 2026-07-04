import { isArchived } from '../commands/utils/storage'
import { defaultModelCapabilities, type ListedModel, type Model } from '../domain/model'
import type { ListedModelProvider, ModelProvider, ModelProviderSummary } from '../domain/model-provider'
import { availableThinkingLevelsForModel, configurableThinkingLevelsForProtocol } from '../providers/model-provider-protocol/thinking'

export function listedModelProviders(modelProviders: ModelProvider[], models: Model[]): ListedModelProvider[] {
	const modelsByProviderId = groupModelsByProviderId(models)

	return sortByCreatedAtThenId(modelProviders).map((provider) => {
		const { archivePeriods, ...providerFields } = provider
		const providerModels = sortByCreatedAtThenId(modelsByProviderId.get(provider.id) ?? []).map((model) => listedModel(model, provider))
		return {
			...providerFields,
			archived: isArchived(archivePeriods),
			configurableThinkingLevels: configurableThinkingLevelsForProtocol(provider.protocol),
			models: providerModels,
		}
	})
}

export function listedModel(model: Model, provider: ModelProvider): ListedModel {
	const { archivePeriods, ...modelFields } = model
	return {
		...modelFields,
		archived: isArchived(archivePeriods),
		availableThinkingLevels: availableThinkingLevelsForModel(model, provider.protocol),
	}
}

export function modelProviderSummary(provider: ModelProvider): ModelProviderSummary {
	return {
		id: provider.id,
		name: provider.name,
		protocol: provider.protocol,
		baseUrl: provider.baseUrl,
		archived: isArchived(provider.archivePeriods),
		configurableThinkingLevels: configurableThinkingLevelsForProtocol(provider.protocol),
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

function sortByCreatedAtThenId<T extends { id: string; created: { at: string } }>(records: T[]): T[] {
	return [...records].sort((left, right) => left.created.at.localeCompare(right.created.at) || left.id.localeCompare(right.id))
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest
	const { stamp } = await import('../utils/test-helpers')

	describe('listedModelProviders', () => {
		it('groups Models under Providers in creation order with archive state and thinking levels', () => {
			const providerA = modelProvider({ id: 'provider-a', createdAt: '2026-06-09T00:00:00.000Z', archived: true })
			const providerB = modelProvider({ id: 'provider-b', createdAt: '2026-06-10T00:00:00.000Z' })
			const modelA = model({ id: 'model-a', providerId: 'provider-a', createdAt: '2026-06-09T00:00:00.000Z' })
			const modelB = model({
				id: 'model-b',
				providerId: 'provider-a',
				createdAt: '2026-06-10T00:00:00.000Z',
				archived: true,
				thinking: { supportedLevels: ['low', 'high'] },
			})
			const modelC = model({ id: 'model-c', providerId: 'missing-provider', createdAt: '2026-06-11T00:00:00.000Z' })

			expect(listedModelProviders([providerB, providerA], [modelB, modelC, modelA])).toEqual([
				{
					...listedProvider(providerA, true),
					configurableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
					models: [listedModelRecord(modelA, false), listedModelRecord(modelB, true, ['none', 'low', 'high'])],
				},
				{
					...listedProvider(providerB, false),
					configurableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
					models: [],
				},
			])
		})
	})

	function modelProvider(input: { id: string; createdAt: string; archived?: boolean }): ModelProvider {
		return {
			id: input.id,
			name: input.id,
			protocol: { type: 'openai-responses' },
			baseUrl: 'https://api.example.com',
			auth: null,
			headers: [],
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
	): Omit<ListedModelProvider, 'configurableThinkingLevels' | 'models'> {
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
