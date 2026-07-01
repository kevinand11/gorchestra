import { isArchived } from '../commands/utils/storage'
import type { ListedModel, Model } from '../domain/model'
import type { ListedModelProvider, ModelProvider } from '../domain/model-provider'

export function listedModelProviders(modelProviders: ModelProvider[], models: Model[]): ListedModelProvider[] {
	const modelsByProviderId = groupModelsByProviderId(sortByCreatedAtThenId(models).map(listedModel))

	return sortByCreatedAtThenId(modelProviders).map((provider) => {
		const { archivePeriods, ...providerFields } = provider
		return { ...providerFields, archived: isArchived(archivePeriods), models: modelsByProviderId.get(provider.id) ?? [] }
	})
}

function listedModel(model: Model): ListedModel {
	const { archivePeriods, ...modelFields } = model
	return { ...modelFields, archived: isArchived(archivePeriods) }
}

function groupModelsByProviderId(models: ListedModel[]): Map<string, ListedModel[]> {
	const grouped = new Map<string, ListedModel[]>()
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
		it('groups Models under Providers in creation order with archive state', () => {
			const providerA = modelProvider({ id: 'provider-a', createdAt: '2026-06-09T00:00:00.000Z', archived: true })
			const providerB = modelProvider({ id: 'provider-b', createdAt: '2026-06-10T00:00:00.000Z' })
			const modelA = model({ id: 'model-a', providerId: 'provider-a', createdAt: '2026-06-09T00:00:00.000Z' })
			const modelB = model({ id: 'model-b', providerId: 'provider-a', createdAt: '2026-06-10T00:00:00.000Z', archived: true })
			const modelC = model({ id: 'model-c', providerId: 'missing-provider', createdAt: '2026-06-11T00:00:00.000Z' })

			expect(listedModelProviders([providerB, providerA], [modelB, modelC, modelA])).toEqual([
				{
					...listedProvider(providerA, true),
					models: [listedModelRecord(modelA, false), listedModelRecord(modelB, true)],
				},
				{ ...listedProvider(providerB, false), models: [] },
			])
		})
	})

	function modelProvider(input: { id: string; createdAt: string; archived?: boolean }): ModelProvider {
		return {
			id: input.id,
			name: input.id,
			protocol: 'openai-responses',
			baseUrl: 'https://api.example.com',
			auth: null,
			headers: [],
			created: { origin: 'imported', at: input.createdAt },
			updated: null,
			archivePeriods: input.archived === true ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function model(input: { id: string; providerId: string; createdAt: string; archived?: boolean }): Model {
		return {
			id: input.id,
			providerId: input.providerId,
			name: input.id,
			providerModelId: input.id,
			created: { origin: 'imported', at: input.createdAt },
			updated: null,
			archivePeriods: input.archived === true ? [{ archived: stamp, unarchived: null }] : [],
		}
	}

	function listedProvider(provider: ModelProvider, archived: boolean): Omit<ListedModelProvider, 'models'> {
		const { archivePeriods: _archivePeriods, ...providerFields } = provider
		return { ...providerFields, archived }
	}

	function listedModelRecord(modelRecord: Model, archived: boolean): ListedModel {
		const { archivePeriods: _archivePeriods, ...modelFields } = modelRecord
		return { ...modelFields, archived }
	}
}
