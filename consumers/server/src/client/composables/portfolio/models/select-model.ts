import { computed, watch, type Ref } from 'vue'

import { useModelProvidersList } from './providers'
import type { UiSelectOption, UiSelectOptionInput } from '../../../components/ui/select-options'
import type { ModelUseFormDraft } from '../../../forms/model-use'
import {
	activeModelOptionGroupsFromProviders,
	modelOptionIds,
	thinkingLevelLabel,
	thinkingLevelOptionsForModel,
} from '../../../utils/model-provider-options'
import type { ModelThinkingLevel, ServerApi } from '../../core/server-api'

type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]

type ModelProviderRef = Readonly<Ref<readonly ListedModelProvider[]>>

type ModelProviderState = {
	providers: ModelProviderRef
	isLoadingProviders: Readonly<Ref<boolean>>
	providersError: Readonly<Ref<string>>
	hasLoadedProviders: Readonly<Ref<boolean>>
}

type UseSelectModelOptions = {
	providerState?: ModelProviderState
	optionalLabel?: string
}

export function useSelectModel(modelUseDraft: ModelUseFormDraft, options: UseSelectModelOptions = {}) {
	const providerState = useModelProviderState(options.providerState)
	const activeModelOptionGroups = computed(() => activeModelOptionGroupsFromProviders(providerState.providers.value))
	const optionalLabel = options.optionalLabel ?? 'Use default'
	const activeModelIds = computed(() => modelOptionIds(activeModelOptionGroups.value))
	const activeModelIdValues = computed(() => [...activeModelIds.value])
	const selectedModelId = computed(() => modelUseDraft.modelId.value)
	const selectedModelIsUnavailable = computed(() =>
		Boolean(
			providerState.hasLoadedProviders.value && selectedModelId.value !== null && !activeModelIds.value.has(selectedModelId.value),
		),
	)
	const unavailableModelOption = computed(() => unavailableModelOptionFor(selectedModelId.value, selectedModelIsUnavailable.value))
	const modelOptions = computed((): UiSelectOptionInput<string>[] => [
		...optionalOption(unavailableModelOption.value),
		...activeModelOptionGroups.value,
	])
	const optionalModelOptions = computed((): UiSelectOptionInput<string | null>[] => [
		{ value: null, label: optionalLabel },
		...optionalOption(unavailableModelOption.value),
		...activeModelOptionGroups.value,
	])
	const hasActiveModels = computed(() => activeModelIds.value.size > 0)
	const activeThinkingLevelOptions = computed(() => thinkingLevelOptionsForModel(providerState.providers.value, selectedModelId.value))
	const thinkingLevelOptions = computed(() =>
		selectedModelIsUnavailable.value
			? [unavailableThinkingLevelOption(modelUseDraft.thinkingLevel.value)]
			: activeThinkingLevelOptions.value,
	)
	const thinkingLevelDisabled = computed(() => selectedModelId.value === null || thinkingLevelOptions.value.length === 0)

	watch(
		() => [
			providerState.hasLoadedProviders.value,
			providerState.providers.value,
			selectedModelId.value,
			modelUseDraft.thinkingLevel.value,
		],
		() =>
			syncSelectOptions(modelUseDraft, providerState.hasLoadedProviders.value, activeModelIdValues.value, thinkingLevelOptions.value),
		{ immediate: true },
	)

	return {
		...providerState,
		activeModelOptionGroups,
		modelOptions,
		optionalModelOptions,
		activeModelIds,
		hasActiveModels,
		thinkingLevelOptions,
		thinkingLevelDisabled,
		selectedModelIsUnavailable,
	}
}

function useModelProviderState(suppliedProviderState: ModelProviderState | undefined): ModelProviderState {
	if (suppliedProviderState !== undefined) return suppliedProviderState

	const modelProvidersList = useModelProvidersList()

	return {
		providers: modelProvidersList.providers,
		isLoadingProviders: modelProvidersList.isLoadingProviders,
		providersError: modelProvidersList.providersError,
		hasLoadedProviders: modelProvidersList.hasLoadedProviders,
	}
}

function syncSelectOptions(
	modelUseDraft: ModelUseFormDraft,
	hasLoadedProviders: boolean,
	activeModelIds: string[],
	thinkingOptions: readonly UiSelectOption<ModelThinkingLevel>[],
): void {
	if (!hasLoadedProviders) {
		modelUseDraft.modelId.clearOptions()
		modelUseDraft.thinkingLevel.clearOptions()
		return
	}

	modelUseDraft.modelId.setOptions(modelUseDraft.requiresModel ? activeModelIds : [null, ...activeModelIds])
	syncThinkingLevel(modelUseDraft, thinkingOptions)
}

function syncThinkingLevel(modelUseDraft: ModelUseFormDraft, options: readonly UiSelectOption<ModelThinkingLevel>[]): void {
	if (modelUseDraft.modelId.value === null) {
		modelUseDraft.thinkingLevel.clearOptions()
		return
	}

	const supportedLevels = options.map((option) => option.value)
	modelUseDraft.thinkingLevel.setOptions(supportedLevels)
	const fallback = supportedLevels[0]
	if (fallback !== undefined && !supportedLevels.includes(modelUseDraft.thinkingLevel.value)) modelUseDraft.thinkingLevel.value = fallback
}

function unavailableModelOptionFor(modelId: string | null, unavailable: boolean): UiSelectOption<string> | null {
	return unavailable && modelId !== null ? { value: modelId, label: `Unavailable Model (${modelId})`, disabled: true } : null
}

function unavailableThinkingLevelOption(level: ModelThinkingLevel): UiSelectOption<ModelThinkingLevel> {
	return { value: level, label: thinkingLevelLabel(level), disabled: true }
}

function optionalOption<TValue>(option: UiSelectOption<TValue> | null): UiSelectOption<TValue>[] {
	return option === null ? [] : [option]
}
