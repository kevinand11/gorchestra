import type { ModelThinkingLevel, ServerApi } from './useServerApi'
import type { UiSelectOption, UiSelectOptionGroup } from '../components/ui/select-options'

type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]

export type ModelSelectOption = UiSelectOption<string>
export type ModelSelectOptionGroup = UiSelectOptionGroup<string>
type ThinkingLevelOption = UiSelectOption<ModelThinkingLevel>
type ListedModel = ListedModelProvider['models'][number]

export const thinkingLevelOptions: ThinkingLevelOption[] = [
	{ value: 'off', label: 'Off' },
	{ value: 'minimal', label: 'Minimal' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'xhigh', label: 'Extra High' },
]

export function thinkingLevelLabel(level: ModelThinkingLevel): string {
	return thinkingLevelOptions.find((option) => option.value === level)?.label ?? level
}

export function activeModelOptionGroupsFromProviders(providers: readonly ListedModelProvider[]): ModelSelectOptionGroup[] {
	return providers.map(activeModelOptionGroup).filter(hasModelOptions)
}

export function modelOptionIds(groups: readonly ModelSelectOptionGroup[]): Set<string> {
	return new Set(groups.flatMap((group) => group.options.map((option) => option.value)))
}

export function modelOptionLabel(groups: readonly ModelSelectOptionGroup[], modelId: string): string {
	return groups.flatMap((group) => group.options).find((option) => option.value === modelId)?.label ?? modelId
}

export function thinkingLevelOptionsForModel(providers: readonly ListedModelProvider[], modelId: string | null): ThinkingLevelOption[] {
	const model = activeModelFromProviders(providers, modelId)
	return model === null ? [] : thinkingLevelOptions.filter((option) => model.availableThinkingLevels.includes(option.value))
}

export function modelHasThinkingLevel(
	providers: readonly ListedModelProvider[],
	modelId: string | null,
	thinkingLevel: ModelThinkingLevel,
): boolean {
	return thinkingLevelOptionsForModel(providers, modelId).some((option) => option.value === thinkingLevel)
}

function activeModelOptionGroup(provider: ListedModelProvider): ModelSelectOptionGroup {
	return {
		label: `${provider.name} · ${provider.protocol.type}`,
		options: provider.archived ? [] : provider.models.filter((model) => !model.archived).map(modelOption),
	}
}

function activeModelFromProviders(providers: readonly ListedModelProvider[], modelId: string | null): ListedModel | null {
	if (modelId === null) return null

	return (
		providers
			.filter((provider) => !provider.archived)
			.flatMap((provider) => provider.models)
			.find((model) => !model.archived && model.id === modelId) ?? null
	)
}

function modelOption(model: ListedModel): ModelSelectOption {
	return { value: model.id, label: `${model.name} (${model.providerModelId})` }
}

function hasModelOptions(group: ModelSelectOptionGroup): boolean {
	return group.options.length > 0
}

if (import.meta.vitest) {
	const { describe, expect, it } = import.meta.vitest

	describe('model-provider-options', () => {
		it('filters thinking levels to the selected active Model capabilities', () => {
			const providers = [
				provider({
					id: 'provider-1',
					models: [
						model({ id: 'model-1', availableThinkingLevels: ['off', 'high'] }),
						model({ id: 'model-archived', availableThinkingLevels: ['off', 'low'], archived: true }),
					],
				}),
				provider({
					id: 'provider-archived',
					archived: true,
					models: [model({ id: 'model-2', availableThinkingLevels: ['medium'] })],
				}),
			] satisfies ListedModelProvider[]

			expect(thinkingLevelOptionsForModel(providers, 'model-1')).toEqual([
				{ value: 'off', label: 'Off' },
				{ value: 'high', label: 'High' },
			])
			expect(thinkingLevelOptionsForModel(providers, null)).toEqual([])
			expect(thinkingLevelOptionsForModel(providers, 'model-archived')).toEqual([])
			expect(thinkingLevelOptionsForModel(providers, 'model-2')).toEqual([])
		})
	})

	function provider(input: { id: string; archived?: boolean; models: ListedModelProvider['models'] }): ListedModelProvider {
		return {
			id: input.id,
			name: input.id,
			protocol: { type: 'openai-responses' },
			baseUrl: 'https://api.example.com',
			auth: null,
			headers: [],
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archived: input.archived ?? false,
			models: input.models,
		}
	}

	function model(input: {
		id: string
		availableThinkingLevels: ModelThinkingLevel[]
		archived?: boolean
	}): ListedModelProvider['models'][number] {
		return {
			id: input.id,
			providerId: 'provider-1',
			name: input.id,
			providerModelId: input.id,
			capabilities: { inputs: ['text'], contextWindowTokens: 128000, maxOutputTokens: 16384, reasoning: null },
			pricing: null,
			availableThinkingLevels: input.availableThinkingLevels,
			created: { origin: 'imported', at: '2026-06-01T00:00:00.000Z' },
			updated: null,
			archived: input.archived ?? false,
		}
	}
}
