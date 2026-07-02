import type { ModelThinkingLevel, ServerApi } from './useServerApi'

type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]

export type ModelSelectOption = { value: string; label: string }
export type ModelSelectOptionGroup = { label: string; options: ModelSelectOption[] }

export const thinkingLevelOptions: Array<{ value: ModelThinkingLevel; label: string }> = [
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

function activeModelOptionGroup(provider: ListedModelProvider): ModelSelectOptionGroup {
	return {
		label: `${provider.name} · ${provider.protocol.type}`,
		options: provider.archived ? [] : provider.models.filter((model) => !model.archived).map(modelOption),
	}
}

function modelOption(model: ListedModelProvider['models'][number]): ModelSelectOption {
	return { value: model.id, label: `${model.name} (${model.providerModelId})` }
}

function hasModelOptions(group: ModelSelectOptionGroup): boolean {
	return group.options.length > 0
}
