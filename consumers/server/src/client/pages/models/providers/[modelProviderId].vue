<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<NuxtLink class="text-sz-helper font-semibold text-primary hover:brightness-110" to="/models/providers">← Models</NuxtLink>
			<h1 class="m-0 mt-2 text-sz-section font-semibold tracking-[-0.01em]">{{ provider?.name ?? 'Loading Model Provider…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Manage provider metadata, lifecycle, and Models under this provider.</p>
		</header>

		<section>
			<div v-if="isLoadingProvider && !hasLoadedProvider" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Model Provider…
			</div>
			<p v-if="isLoadingProvider && hasLoadedProvider" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Model Provider…
			</p>
			<div v-else-if="providerError" class="border-b border-dimmer px-3 py-4 text-error">{{ providerError }}</div>
			<div v-else-if="provider" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Provider metadata</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Status</span
							><span :class="provider.archived ? 'text-dim' : 'text-success'">{{
								provider.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Protocol</span><span class="font-mono">{{ provider.protocol.type }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2 sm:col-span-2">
							<span class="text-dim">Base URL</span><span class="min-w-0 truncate font-mono">{{ provider.baseUrl }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Auth Secret</span
							><span>{{ provider.auth === null ? 'None' : provider.auth.secretId }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Headers</span><span>{{ provider.headers.length }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(provider.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Updated</span
							><span>{{ provider.updated === null ? 'Never' : formatDate(provider.updated.at) }}</span>
						</div>
					</div>
				</section>

				<section>
					<div class="flex min-h-11 items-center justify-between gap-3 border-b border-dimmer px-3 py-2">
						<h2 class="m-0 text-sz-subsection font-semibold">Models</h2>
						<span class="text-sz-helper text-dim"
							>{{ provider.models.length }} {{ modelCountLabel(provider.models.length) }}</span
						>
					</div>
					<div v-if="provider.models.length === 0" class="border-b border-dimmer px-3 py-4">
						<h3 class="m-0 text-sz-helper font-semibold">No Models yet.</h3>
						<p class="m-0 mt-1 text-sz-helper text-dim">
							Add a Model from the right rail before selecting this provider in Portfolio Config.
						</p>
					</div>
					<div v-else>
						<div
							v-for="model in provider.models"
							:key="model.id"
							class="grid min-h-[54px] grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-dimmer px-3 py-3"
							:class="model.archived ? 'opacity-50' : ''">
							<div class="min-w-0">
								<strong class="block truncate font-semibold">{{ model.name }}</strong>
								<span class="mt-1 block truncate text-sz-helper text-dim font-mono">{{ model.providerModelId }}</span>
							</div>
							<span class="self-center text-sz-helper" :class="model.archived ? 'text-dim' : 'text-success'">{{
								model.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
					</div>
				</section>
			</div>
		</section>

		<template v-if="provider" #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<div>
						<h2 class="m-0 text-sz-subsection font-semibold">Provider actions</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Edit metadata and Secret references without changing the protocol.
						</p>
					</div>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="saveProvider()">
						<UiFormGroup label="Provider name" for-id="provider-name" :error="providerForm.errors.name">
							<UiInput id="provider-name" v-model="providerForm.name" :invalid="!!providerForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="Base URL" for-id="provider-base-url" :error="providerForm.errors.baseUrl">
							<UiInput id="provider-base-url" v-model="providerForm.baseUrl" :invalid="!!providerForm.errors.baseUrl" />
						</UiFormGroup>
						<UiFormGroup label="API key Secret" for-id="provider-auth-secret" :error="providerForm.errors.authSecretId">
							<UiSelect
								id="provider-auth-secret"
								v-model="providerForm.authSecretId"
								:options="authSecretOptions"
								placeholder="No auth Secret" />
						</UiFormGroup>
						<div class="flex flex-wrap items-center gap-2">
							<UiButton
								type="submit"
								variant="secondary"
								:loading="isSavingProvider"
								:disabled="!providerForm.valid || !providerForm.dirty"
								>Save Provider</UiButton
							>
						</div>
						<UiText v-if="saveProviderError" tone="error">{{ saveProviderError }}</UiText>
					</UiForm>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Provider lifecycle</h2>
					<div class="mt-3">
						<UiButton
							v-if="provider.archived"
							type="button"
							variant="secondary"
							:loading="isChangingProviderLifecycle"
							@click="unarchiveProvider()"
							>Unarchive Provider</UiButton
						>
						<UiButton
							v-else
							type="button"
							variant="ghost"
							:loading="isChangingProviderLifecycle"
							@click="requestProviderArchive()"
							>Archive Provider</UiButton
						>
					</div>
					<UiCallout v-if="pendingArchiveTarget === 'provider'" class="mt-3" tone="notice">
						Archiving can make Portfolio Config references unusable until the config is changed.
						<span class="mt-2 flex gap-2">
							<UiButton type="button" variant="secondary" @click="archiveProvider()">Confirm archive</UiButton>
							<UiButton type="button" variant="ghost" @click="pendingArchiveTarget = null">Cancel</UiButton>
						</span>
					</UiCallout>
					<UiText v-if="providerLifecycleError" tone="error">{{ providerLifecycleError }}</UiText>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<div>
						<h2 class="m-0 text-sz-subsection font-semibold">Add Model</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Add Models under this Provider before selecting them in Portfolio Config.
						</p>
					</div>
					<UiForm class="mt-3 grid gap-3" @submit.prevent="createModel()">
						<UiFormGroup label="New Model name" for-id="model-name" :error="modelCreationForm.errors.name">
							<UiInput
								id="model-name"
								v-model="modelCreationForm.name"
								placeholder="GPT 4.1"
								:invalid="!!modelCreationForm.errors.name" />
						</UiFormGroup>
						<UiFormGroup label="Provider model id" for-id="provider-model-id" :error="modelCreationForm.errors.providerModelId">
							<UiInput
								id="provider-model-id"
								v-model="modelCreationForm.providerModelId"
								placeholder="gpt-4.1"
								:invalid="!!modelCreationForm.errors.providerModelId" />
						</UiFormGroup>
						<UiButton
							type="submit"
							variant="secondary"
							:loading="isCreatingModel"
							:disabled="!modelCreationForm.valid || provider.archived"
							>Add Model</UiButton
						>
						<UiText v-if="createModelError" tone="error">{{ createModelError }}</UiText>
					</UiForm>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<UiFormGroup label="Selected Model" for-id="selected-model">
						<UiSelect
							id="selected-model"
							v-model="selectedModelId"
							:options="modelOptions"
							placeholder="Select Model"
							:disabled="provider.models.length === 0" />
					</UiFormGroup>
					<UiForm v-if="selectedModel" class="mt-3 grid gap-3" @submit.prevent="saveModel()">
						<UiFormGroup label="Model name" for-id="selected-model-name" :error="modelUpdateForm.errors.name">
							<UiInput id="selected-model-name" v-model="modelUpdateForm.name" :invalid="!!modelUpdateForm.errors.name" />
						</UiFormGroup>
						<div class="grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Context window tokens" for-id="context-window-tokens">
								<UiInput
									id="context-window-tokens"
									type="number"
									:min="1"
									:model-value="modelUpdateForm.capabilities.contextWindowTokens"
									@update:model-value="setModelCapability('contextWindowTokens', numberFieldValue($event))" />
							</UiFormGroup>
							<UiFormGroup label="Max output tokens" for-id="max-output-tokens">
								<UiInput
									id="max-output-tokens"
									type="number"
									:min="1"
									:model-value="modelUpdateForm.capabilities.maxOutputTokens"
									@update:model-value="setModelCapability('maxOutputTokens', numberFieldValue($event))" />
							</UiFormGroup>
						</div>
						<div class="border-y border-dimmer">
							<div class="py-2 text-sz-helper font-semibold text-dim">Reasoning</div>
							<div v-for="level in thinkingLevels" :key="level" class="grid gap-2 border-t border-dimmer py-2">
								<label class="flex items-center gap-2 text-sz-helper">
									<input
										:checked="isReasoningLevelEnabled(level)"
										type="checkbox"
										@change="setReasoningLevelEnabled(level, isChecked($event))" />
									{{ thinkingLevelLabel(level) }}
								</label>
								<UiInput
									:model-value="reasoningProviderValue(level)"
									:disabled="!isReasoningLevelEnabled(level)"
									placeholder="Provider value"
									@update:model-value="setReasoningProviderValue(level, String($event))" />
							</div>
						</div>
						<div class="border-b border-dimmer pb-3">
							<div class="flex items-center justify-between gap-3 py-2">
								<span class="text-sz-helper font-semibold text-dim">Pricing</span>
								<UiButton type="button" variant="ghost" @click="togglePricing()">{{
									modelUpdateForm.pricing === null ? 'Configure' : 'Clear'
								}}</UiButton>
							</div>
							<div v-if="modelUpdateForm.pricing !== null" class="grid gap-3 md:grid-cols-2">
								<UiFormGroup label="Input $/M" for-id="pricing-input"
									><UiInput
										id="pricing-input"
										:model-value="pricingUsdPerMillion('input')"
										@update:model-value="setPricingUsdPerMillion('input', String($event))"
								/></UiFormGroup>
								<UiFormGroup label="Output $/M" for-id="pricing-output"
									><UiInput
										id="pricing-output"
										:model-value="pricingUsdPerMillion('output')"
										@update:model-value="setPricingUsdPerMillion('output', String($event))"
								/></UiFormGroup>
								<UiFormGroup label="Cache read $/M" for-id="pricing-cache-read"
									><UiInput
										id="pricing-cache-read"
										:model-value="pricingUsdPerMillion('cacheRead')"
										@update:model-value="setPricingUsdPerMillion('cacheRead', String($event))"
								/></UiFormGroup>
								<UiFormGroup label="Cache write $/M" for-id="pricing-cache-write"
									><UiInput
										id="pricing-cache-write"
										:model-value="pricingUsdPerMillion('cacheWrite')"
										@update:model-value="setPricingUsdPerMillion('cacheWrite', String($event))"
								/></UiFormGroup>
							</div>
						</div>
						<UiButton
							type="submit"
							variant="secondary"
							:loading="isSavingModel"
							:disabled="!modelUpdateForm.valid || !modelUpdateForm.dirty"
							>Save Model</UiButton
						>
						<UiText v-if="saveModelError" tone="error">{{ saveModelError }}</UiText>
					</UiForm>
				</section>

				<section v-if="selectedModel" class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Model Preflight</h2>
					<div class="mt-3 grid gap-2">
						<UiButton
							type="button"
							variant="secondary"
							:loading="isPreflightingModel"
							:disabled="selectedModel.archived || provider.archived"
							@click="preflightModel()"
							>Preflight Model</UiButton
						>
						<UiCallout v-if="preflightEvidence" :tone="preflightEvidence.passed ? 'success' : 'error'">
							{{ preflightEvidence.summary }}
						</UiCallout>
						<UiText v-if="preflightModelError" tone="error">{{ preflightModelError }}</UiText>
					</div>
				</section>

				<section v-if="selectedModel" class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Model lifecycle</h2>
					<div class="mt-3">
						<UiButton
							v-if="selectedModel.archived"
							type="button"
							variant="secondary"
							:loading="isChangingModelLifecycle"
							@click="unarchiveModel()"
							>Unarchive Model</UiButton
						>
						<UiButton v-else type="button" variant="ghost" :loading="isChangingModelLifecycle" @click="requestModelArchive()"
							>Archive Model</UiButton
						>
					</div>
					<UiCallout v-if="pendingArchiveTarget === 'model'" class="mt-3" tone="notice">
						Archiving can make current Portfolio Config references unusable until the config is changed.
						<span class="mt-2 flex gap-2">
							<UiButton type="button" variant="secondary" @click="archiveModel()">Confirm archive</UiButton>
							<UiButton type="button" variant="ghost" @click="pendingArchiveTarget = null">Cancel</UiButton>
						</span>
					</UiCallout>
					<UiText v-if="modelLifecycleError" tone="error">{{ modelLifecycleError }}</UiText>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiCallout from '../../../components/ui/UiCallout.vue'
import UiForm from '../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import UiText from '../../../components/ui/UiText.vue'
import { useApiAction } from '../../../composables/action-state'
import { usePortfolioModelProviderQuery, usePortfolioSecretsQuery } from '../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../composables/selected-portfolio'
import { useServerApi, type ModelThinkingLevel, type ModelTokenPricing, type ServerApi } from '../../../composables/useServerApi'
import { ModelProviderFormDraft } from '../../../forms/model-provider'
import { ModelCreationFormDraft, ModelUpdateFormDraft } from '../../../forms/model'
import { thinkingLevelLabel, thinkingLevelOptions } from '../../../composables/model-provider-options'
import { useToasts } from '../../../composables/toasts'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type ModelProviderDetails = Awaited<ReturnType<ServerApi['getModelProvider']>>
type ListedModel = ModelProviderDetails['models'][number]
type PreflightEvidence = Awaited<ReturnType<ServerApi['preflightModel']>>
type ArchiveTarget = 'provider' | 'model'

const route = useRoute()
const modelProviderId = computed(() => route.params.modelProviderId as string)
const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, invalidate } = useQueryCache()
const providerForm = new ModelProviderFormDraft()
const modelCreationForm = new ModelCreationFormDraft()
const modelUpdateForm = new ModelUpdateFormDraft()
const selectedModelId = ref('')
const pendingArchiveTarget = ref<ArchiveTarget | null>(null)
const preflightEvidence = ref<PreflightEvidence | null>(null)
const thinkingLevels = thinkingLevelOptions.map((option) => option.value)

const {
	data: provider,
	isLoading: isLoadingProvider,
	error: providerError,
	hasExecuted: hasLoadedProvider,
} = usePortfolioModelProviderQuery(serverApi, modelProviderId)
const { data: secrets } = usePortfolioSecretsQuery(serverApi)

const secretOptions = computed(() =>
	secrets.value.filter((secret) => !secret.archived).map((secret) => ({ value: secret.id, label: secret.name })),
)
const authSecretOptions = computed(() => [{ value: '', label: 'No auth Secret' }, ...secretOptions.value])
const modelOptions = computed(
	() => provider.value?.models.map((model) => ({ value: model.id, label: `${model.name} (${model.providerModelId})` })) ?? [],
)
const selectedModel = computed(() => provider.value?.models.find((model) => model.id === selectedModelId.value) ?? null)

watch(
	provider,
	(loadedProvider) => {
		if (loadedProvider === null) return
		providerForm.loadEntity({
			name: loadedProvider.name,
			protocol: loadedProvider.protocol,
			baseUrl: loadedProvider.baseUrl,
			auth: loadedProvider.auth,
			headers: loadedProvider.headers,
		})
		selectedModelId.value = selectedProviderModelId(loadedProvider.models)
	},
	{ immediate: true },
)

watch(
	selectedModel,
	(model) => {
		if (model === null) return
		modelUpdateForm.loadEntity({ name: model.name, capabilities: model.capabilities, pricing: model.pricing })
		preflightEvidence.value = null
	},
	{ immediate: true },
)

const {
	isLoading: isSavingProvider,
	error: saveProviderError,
	execute: saveProvider,
} = useApiAction(async () => {
	const { protocol: _protocol, ...input } = providerForm.toModel()
	const updated = await serverApi.updateModelProvider(modelProviderId.value, input)
	invalidateProviderQueries()
	toasts.success({ title: 'Model Provider saved.', body: updated.name })
})

const {
	isLoading: isChangingProviderLifecycle,
	error: providerLifecycleError,
	execute: runProviderLifecycle,
} = useApiAction(async (action: 'archive' | 'unarchive') => {
	const updated =
		action === 'archive'
			? await serverApi.archiveModelProvider(modelProviderId.value)
			: await serverApi.unarchiveModelProvider(modelProviderId.value)
	pendingArchiveTarget.value = null
	invalidateProviderQueries()
	toasts.success({ title: action === 'archive' ? 'Model Provider archived.' : 'Model Provider unarchived.', body: updated.name })
})

const {
	isLoading: isCreatingModel,
	error: createModelError,
	execute: createModel,
} = useApiAction(async () => {
	const model = await serverApi.createModel(modelProviderId.value, modelCreationForm.toModel())
	selectedModelId.value = model.id
	modelCreationForm.reset()
	invalidateProviderQueries()
	toasts.success({ title: 'Model added.', body: model.name })
})

const {
	isLoading: isSavingModel,
	error: saveModelError,
	execute: saveModel,
} = useApiAction(async () => {
	const model = await serverApi.updateModel(modelProviderId.value, requireSelectedModel().id, modelUpdateForm.toModel())
	invalidateProviderQueries()
	toasts.success({ title: 'Model saved.', body: model.name })
})

const {
	isLoading: isChangingModelLifecycle,
	error: modelLifecycleError,
	execute: runModelLifecycle,
} = useApiAction(async (action: 'archive' | 'unarchive') => {
	const model = requireSelectedModel()
	const updated =
		action === 'archive'
			? await serverApi.archiveModel(modelProviderId.value, model.id)
			: await serverApi.unarchiveModel(modelProviderId.value, model.id)
	pendingArchiveTarget.value = null
	invalidateProviderQueries()
	toasts.success({ title: action === 'archive' ? 'Model archived.' : 'Model unarchived.', body: updated.name })
})

const {
	isLoading: isPreflightingModel,
	error: preflightModelError,
	execute: preflightModel,
} = useApiAction(async () => {
	preflightEvidence.value = await serverApi.preflightModel(modelProviderId.value, requireSelectedModel().id)
})

function invalidateProviderQueries(): void {
	invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id), { exact: true })
	invalidate(queryKeys.portfolio.modelProvider(portfolio.value.id, modelProviderId.value), { exact: true })
}

function requestProviderArchive(): void {
	pendingArchiveTarget.value = 'provider'
}

function archiveProvider(): Promise<unknown> {
	return runProviderLifecycle('archive')
}

function unarchiveProvider(): Promise<unknown> {
	return runProviderLifecycle('unarchive')
}

function requestModelArchive(): void {
	pendingArchiveTarget.value = 'model'
}

function archiveModel(): Promise<unknown> {
	return runModelLifecycle('archive')
}

function unarchiveModel(): Promise<unknown> {
	return runModelLifecycle('unarchive')
}

function requireSelectedModel(): ListedModel {
	if (selectedModel.value === null) throw new Error('Select a Model first')
	return selectedModel.value
}

function selectedProviderModelId(models: ListedModel[]): string {
	return models.some((model) => model.id === selectedModelId.value) ? selectedModelId.value : (models[0]?.id ?? '')
}

function numberFieldValue(value: string | number): number {
	return typeof value === 'number' ? value : Number(value)
}

function setModelCapability(field: 'contextWindowTokens' | 'maxOutputTokens', value: number): void {
	modelUpdateForm.capabilities = { ...modelUpdateForm.capabilities, [field]: value }
}

function isReasoningLevelEnabled(level: ModelThinkingLevel): boolean {
	return modelUpdateForm.capabilities.reasoning?.[level] !== null && modelUpdateForm.capabilities.reasoning?.[level] !== undefined
}

function setReasoningLevelEnabled(level: ModelThinkingLevel, enabled: boolean): void {
	const reasoning = reasoningMap()
	modelUpdateForm.capabilities = {
		...modelUpdateForm.capabilities,
		reasoning: { ...reasoning, [level]: enabled ? { type: 'provider-value', value: reasoningProviderValue(level) || level } : null },
	}
}

function reasoningProviderValue(level: ModelThinkingLevel): string {
	return modelUpdateForm.capabilities.reasoning?.[level]?.value ?? ''
}

function setReasoningProviderValue(level: ModelThinkingLevel, value: string): void {
	if (!isReasoningLevelEnabled(level)) return
	modelUpdateForm.capabilities = {
		...modelUpdateForm.capabilities,
		reasoning: { ...reasoningMap(), [level]: { type: 'provider-value', value } },
	}
}

function reasoningMap(): NonNullable<typeof modelUpdateForm.capabilities.reasoning> {
	return modelUpdateForm.capabilities.reasoning ?? { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null }
}

function isChecked(event: Event): boolean {
	return event.target instanceof HTMLInputElement && event.target.checked
}

function togglePricing(): void {
	modelUpdateForm.pricing = modelUpdateForm.pricing === null ? emptyPricing() : null
}

function emptyPricing(): ModelTokenPricing {
	return { unit: 'micro-usd-per-million-tokens', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function pricingUsdPerMillion(field: keyof Omit<ModelTokenPricing, 'unit'>): string {
	return modelUpdateForm.pricing === null ? '' : String(modelUpdateForm.pricing[field] / 1_000_000)
}

function setPricingUsdPerMillion(field: keyof Omit<ModelTokenPricing, 'unit'>, value: string): void {
	const pricing = modelUpdateForm.pricing ?? emptyPricing()
	modelUpdateForm.pricing = { ...pricing, [field]: Math.round(Number(value) * 1_000_000) }
}

function modelCountLabel(count: number): string {
	return count === 1 ? 'Model' : 'Models'
}
</script>
