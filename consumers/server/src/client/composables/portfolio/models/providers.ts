import { computed, ref, watch, type Ref } from 'vue'

import { ModelCreationFormDraft, ModelUpdateFormDraft } from '../../../forms/model'
import { ModelProviderFormDraft, type ModelProviderFormModel } from '../../../forms/model-provider'
import { useSelectedPortfolio } from '../../auth/session'
import { useApiAction, useFetchAction } from '../../core/action-state'
import { useOverlay } from '../../core/overlay'
import { useQueryCache } from '../../core/query-cache'
import { useServerApi, type ServerApi, type UpdateModelProviderInput } from '../../core/server-api'

export type ListedModelProvider = Awaited<ReturnType<ServerApi['listModelProviders']>>[number]
type ModelProviderDetails = Awaited<ReturnType<ServerApi['getModelProvider']>>
type CreatedModelProvider = Awaited<ReturnType<ServerApi['createModelProvider']>>
type UpdatedModelProvider = Awaited<ReturnType<ServerApi['updateModelProvider']>>
type ModelDetails = Awaited<ReturnType<ServerApi['getModel']>>
type CreatedModel = Awaited<ReturnType<ServerApi['createModel']>>
type UpdatedModel = Awaited<ReturnType<ServerApi['updateModel']>>
type ModelReference = Awaited<ReturnType<ServerApi['listModelReferences']>>[number]
type ModelPreflightEvidence = Awaited<ReturnType<ServerApi['preflightModel']>>
type ModelProviderLifecycleAction = 'archive' | 'unarchive'
type ModelLifecycleAction = 'archive' | 'unarchive'

type ModelProviderCreateOptions = {
	onSuccess?: (provider: CreatedModelProvider) => void | Promise<void>
}

type ModelProviderLifecycleOptions = {
	onSuccess?: (provider: UpdatedModelProvider, action: ModelProviderLifecycleAction) => void | Promise<void>
}

type ModelCreateOptions = {
	onSuccess?: (model: CreatedModel) => void | Promise<void>
}

type ModelLifecycleOptions = {
	onSuccess?: (model: UpdatedModel, action: ModelLifecycleAction) => void | Promise<void>
}

type ModelProviderRef = Readonly<Ref<ModelProviderDetails | null>>
type ModelRef = Readonly<Ref<ModelDetails | null>>

export function useModelProvidersList() {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: providers,
		isLoading: isLoadingProviders,
		error: providersError,
		hasExecuted: hasLoadedProviders,
		execute: refreshProviders,
		reset: resetProviders,
	} = useFetchAction(() => serverApi.listModelProviders(), {
		queryKey: queryKeys.portfolio.modelProviders(portfolio.value.id),
		initialData: [] as ListedModelProvider[],
	})
	const isRefreshingProviders = computed(() => isLoadingProviders.value && hasLoadedProviders.value)

	return { providers, isLoadingProviders, providersError, hasLoadedProviders, isRefreshingProviders, refreshProviders, resetProviders }
}

export function useModelProviderDetail(modelProviderId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: provider,
		isLoading: isLoadingProvider,
		error: providerError,
		hasExecuted: hasLoadedProvider,
		execute: refreshProvider,
		reset: resetProvider,
	} = useFetchAction(() => serverApi.getModelProvider(modelProviderId.value), {
		queryKey: queryKeys.portfolio.modelProvider(portfolio.value.id, modelProviderId.value),
		initialData: null as ModelProviderDetails | null,
	})
	const isRefreshingProvider = computed(() => isLoadingProvider.value && hasLoadedProvider.value)

	return { provider, isLoadingProvider, providerError, hasLoadedProvider, isRefreshingProvider, refreshProvider, resetProvider }
}

export function useModelProviderCreate(options: ModelProviderCreateOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const providerForm = new ModelProviderFormDraft()
	const { queryKeys } = queryCache
	const {
		isLoading: isCreatingProvider,
		error: createProviderError,
		execute: createProvider,
		reset: resetCreateProvider,
	} = useApiAction(async () => {
		const provider = await serverApi.createModelProvider(providerForm.toModel())
		queryCache.invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id), { exact: true })
		toast.success({ title: 'Model Provider created.', body: provider.name })
		await options.onSuccess?.(provider)
		return provider
	})

	return { providerForm, isCreatingProvider, createProviderError, createProvider, resetCreateProvider }
}

export function useModelProviderUpdate(modelProviderId: Ref<string>, provider: ModelProviderRef) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const providerForm = new ModelProviderFormDraft()

	watch(
		provider,
		(loadedProvider) => {
			if (loadedProvider === null) return
			providerForm.loadEntity(loadedProvider)
		},
		{ immediate: true },
	)

	const {
		isLoading: isSavingProvider,
		error: saveProviderError,
		execute: saveProvider,
		reset: resetSaveProvider,
	} = useApiAction(async () => {
		const updated = await serverApi.updateModelProvider(modelProviderId.value, modelProviderUpdateInput(providerForm.toModel()))
		invalidateModelProviderQueries(queryCache, portfolio.value.id, modelProviderId.value)
		toast.success({ title: 'Model Provider saved.', body: updated.name })
		return updated
	})

	return { providerForm, isSavingProvider, saveProviderError, saveProvider, resetSaveProvider }
}

export function useModelProviderLifecycle(modelProviderId: Ref<string>, options: ModelProviderLifecycleOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const {
		isLoading: isChangingProviderLifecycle,
		error: providerLifecycleError,
		execute: runProviderLifecycle,
		reset: resetProviderLifecycle,
	} = useApiAction(async (action: ModelProviderLifecycleAction) => {
		const updated =
			action === 'archive'
				? await serverApi.archiveModelProvider(modelProviderId.value)
				: await serverApi.unarchiveModelProvider(modelProviderId.value)
		invalidateModelProviderQueries(queryCache, portfolio.value.id, modelProviderId.value)
		toast.success({ title: action === 'archive' ? 'Model Provider archived.' : 'Model Provider unarchived.', body: updated.name })
		await options.onSuccess?.(updated, action)
		return updated
	})

	return { isChangingProviderLifecycle, providerLifecycleError, runProviderLifecycle, resetProviderLifecycle }
}

export function useModelCreate(modelProviderId: Ref<string>, options: ModelCreateOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const modelCreationForm = new ModelCreationFormDraft()
	const {
		isLoading: isCreatingModel,
		error: createModelError,
		execute: createModel,
		reset: resetCreateModel,
	} = useApiAction(async () => {
		const model = await serverApi.createModel(modelProviderId.value, modelCreationForm.toModel())
		modelCreationForm.reset()
		invalidateModelProviderQueries(queryCache, portfolio.value.id, modelProviderId.value)
		toast.success({ title: 'Model added.', body: model.name })
		await options.onSuccess?.(model)
		return model
	})

	return { modelCreationForm, isCreatingModel, createModelError, createModel, resetCreateModel }
}

export function useModelDetail(modelProviderId: Ref<string>, modelId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: model,
		isLoading: isLoadingModel,
		error: modelError,
		hasExecuted: hasLoadedModel,
		execute: refreshModel,
		reset: resetModel,
	} = useFetchAction(() => serverApi.getModel(modelProviderId.value, modelId.value), {
		queryKey: queryKeys.portfolio.model(portfolio.value.id, modelProviderId.value, modelId.value),
		initialData: null as ModelDetails | null,
	})
	const isRefreshingModel = computed(() => isLoadingModel.value && hasLoadedModel.value)

	return { model, isLoadingModel, modelError, hasLoadedModel, isRefreshingModel, refreshModel, resetModel }
}

export function useModelReferences(modelProviderId: Ref<string>, modelId: Ref<string>) {
	const serverApi = useServerApi()
	const { portfolio } = useSelectedPortfolio()
	const { queryKeys } = useQueryCache()
	const {
		data: references,
		isLoading: isLoadingReferences,
		error: referencesError,
		hasExecuted: hasLoadedReferences,
		execute: refreshReferences,
		reset: resetReferences,
	} = useFetchAction(() => serverApi.listModelReferences(modelProviderId.value, modelId.value), {
		queryKey: queryKeys.portfolio.modelReferences(portfolio.value.id, modelProviderId.value, modelId.value),
		initialData: [] as ModelReference[],
	})
	const isRefreshingReferences = computed(() => isLoadingReferences.value && hasLoadedReferences.value)

	return {
		references,
		isLoadingReferences,
		referencesError,
		hasLoadedReferences,
		isRefreshingReferences,
		refreshReferences,
		resetReferences,
	}
}

export function useModelUpdate(modelProviderId: Ref<string>, modelId: Ref<string>, model: ModelRef) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const modelUpdateForm = new ModelUpdateFormDraft()

	watch(
		model,
		(loadedModel) => {
			if (loadedModel === null) return
			modelUpdateForm.setConfigurableThinkingLevels(loadedModel.provider.configurableThinkingLevels)
			modelUpdateForm.loadEntity({ name: loadedModel.name, capabilities: loadedModel.capabilities, pricing: loadedModel.pricing })
		},
		{ immediate: true },
	)

	const {
		isLoading: isSavingModel,
		error: saveModelError,
		execute: saveModel,
		reset: resetSaveModel,
	} = useApiAction(async () => {
		const updated = await serverApi.updateModel(modelProviderId.value, modelId.value, modelUpdateForm.toModel())
		invalidateModelQueries(queryCache, portfolio.value.id, modelProviderId.value, modelId.value)
		toast.success({ title: 'Model saved.', body: updated.name })
		return updated
	})

	return { modelUpdateForm, isSavingModel, saveModelError, saveModel, resetSaveModel }
}

export function useModelPreflight(modelProviderId: Ref<string>, modelId: Ref<string>, model?: ModelRef) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const preflightEvidence = ref<ModelPreflightEvidence | null>(null)

	watch(
		() => [modelProviderId.value, modelId.value, model?.value] as const,
		() => {
			preflightEvidence.value = null
		},
	)

	const {
		isLoading: isPreflightingModel,
		error: preflightModelError,
		execute: preflightModel,
		reset: resetModelPreflight,
	} = useApiAction(async () => {
		const evidence = await serverApi.preflightModel(modelProviderId.value, modelId.value)
		preflightEvidence.value = evidence
		if (evidence.passed) toast.success({ title: 'Model preflight passed.', body: evidence.summary })
		else toast.info({ title: 'Model preflight failed.', body: evidence.summary })
		return evidence
	})

	return { preflightEvidence, isPreflightingModel, preflightModelError, preflightModel, resetModelPreflight }
}

export function useModelLifecycle(modelProviderId: Ref<string>, modelId: Ref<string>, options: ModelLifecycleOptions = {}) {
	const serverApi = useServerApi()
	const { toast } = useOverlay()
	const queryCache = useQueryCache()
	const { portfolio } = useSelectedPortfolio()
	const {
		isLoading: isChangingModelLifecycle,
		error: modelLifecycleError,
		execute: runModelLifecycle,
		reset: resetModelLifecycle,
	} = useApiAction(async (action: ModelLifecycleAction) => {
		const updated =
			action === 'archive'
				? await serverApi.archiveModel(modelProviderId.value, modelId.value)
				: await serverApi.unarchiveModel(modelProviderId.value, modelId.value)
		invalidateModelQueries(queryCache, portfolio.value.id, modelProviderId.value, modelId.value)
		toast.success({ title: action === 'archive' ? 'Model archived.' : 'Model unarchived.', body: updated.name })
		await options.onSuccess?.(updated, action)
		return updated
	})

	return { isChangingModelLifecycle, modelLifecycleError, runModelLifecycle, resetModelLifecycle }
}

function modelProviderUpdateInput(formModel: ModelProviderFormModel): UpdateModelProviderInput {
	return { name: formModel.name, baseUrl: formModel.baseUrl, auth: formModel.auth, headers: formModel.headers }
}

function invalidateModelProviderQueries(queryCache: ReturnType<typeof useQueryCache>, portfolioId: string, modelProviderId: string): void {
	queryCache.invalidate(queryCache.queryKeys.portfolio.modelProviders(portfolioId), { exact: true })
	queryCache.invalidate(queryCache.queryKeys.portfolio.modelProvider(portfolioId, modelProviderId), { exact: true })
}

function invalidateModelQueries(
	queryCache: ReturnType<typeof useQueryCache>,
	portfolioId: string,
	modelProviderId: string,
	modelId: string,
): void {
	queryCache.invalidate(queryCache.queryKeys.portfolio.model(portfolioId, modelProviderId, modelId), { exact: true })
	queryCache.invalidate(queryCache.queryKeys.portfolio.modelReferences(portfolioId, modelProviderId, modelId), { exact: true })
	invalidateModelProviderQueries(queryCache, portfolioId, modelProviderId)
}
