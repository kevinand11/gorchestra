import { computed, watch, type Ref } from 'vue'

import { activeModelOptionGroupsFromProviders, modelOptionIds, thinkingLevelOptionsForModel } from './model-provider-options'
import { usePortfolioModelProvidersQuery } from './portfolio-resource-queries'
import { useServerApi, type ModelThinkingLevel, type ServerApi } from './useServerApi'
import type { UiSelectOptionInput } from '../components/ui/select-options'
import type { ModelUseFormDraft } from '../forms/model-use'

type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]

type ModelProviderRef = Readonly<Ref<readonly ListedModelProvider[]>>

type UseSelectModelOptions = {
	providers?: ModelProviderRef
	optionalLabel?: string
}

export function useSelectModel(modelUseDraft: ModelUseFormDraft, options: UseSelectModelOptions = {}) {
	const providerState = useModelProviderState(options.providers)
	const activeModelOptionGroups = computed(() => activeModelOptionGroupsFromProviders(providerState.providers.value))
	const optionalLabel = options.optionalLabel ?? 'Use default'
	const modelOptions = computed(() => activeModelOptionGroups.value)
	const optionalModelOptions = computed((): UiSelectOptionInput<string | null>[] => [
		{ value: null, label: optionalLabel },
		...activeModelOptionGroups.value,
	])
	const activeModelIds = computed(() => modelOptionIds(activeModelOptionGroups.value))
	const hasActiveModels = computed(() => activeModelIds.value.size > 0)
	const thinkingLevelOptions = computed(() => thinkingLevelOptionsForModel(providerState.providers.value, modelUseDraft.modelId))
	const thinkingLevelDisabled = computed(() => modelUseDraft.modelId === null || thinkingLevelOptions.value.length === 0)

	watch(
		() => [providerState.providers.value, modelUseDraft.modelId, modelUseDraft.thinkingLevel],
		() => syncThinkingLevel(modelUseDraft, thinkingLevelOptions.value),
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
	}
}

function useModelProviderState(providers: ModelProviderRef | undefined) {
	if (providers !== undefined) {
		return {
			providers,
			isLoadingProviders: computed(() => false),
			providersError: computed(() => ''),
			hasLoadedProviders: computed(() => true),
		}
	}

	const serverApi = useServerApi()
	const {
		data,
		isLoading: isLoadingProviders,
		error: providersError,
		hasExecuted: hasLoadedProviders,
	} = usePortfolioModelProvidersQuery(serverApi)

	return { providers: data, isLoadingProviders, providersError, hasLoadedProviders }
}

function syncThinkingLevel(modelUseDraft: ModelUseFormDraft, options: readonly { value: ModelThinkingLevel }[]): void {
	const supportedLevels = options.map((option) => option.value)
	modelUseDraft.setSupportedThinkingLevels(supportedLevels)
	if (modelUseDraft.modelId === null) return

	const fallback = supportedLevels[0]
	if (fallback !== undefined && !supportedLevels.includes(modelUseDraft.thinkingLevel)) modelUseDraft.thinkingLevel = fallback
}
