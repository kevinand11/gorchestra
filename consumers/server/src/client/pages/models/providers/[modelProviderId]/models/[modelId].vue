<template>
	<NuxtLayout name="portfolio">
		<header class="border-b border-dimmer px-3 py-3">
			<NuxtLink class="text-sz-helper font-semibold text-primary hover:brightness-110" :to="`/models/providers/${modelProviderId}`">
				← Model Provider
			</NuxtLink>
			<h1 class="m-0 mt-2 text-sz-section font-semibold tracking-[-0.01em]">{{ model?.name ?? 'Loading Model…' }}</h1>
			<p class="m-0 mt-1 text-sz-helper text-dim">Manage Model metadata, capabilities, preflight, lifecycle, and references.</p>
		</header>

		<section>
			<div v-if="isLoadingModel && !hasLoadedModel" class="border-b border-dimmer px-3 py-4 text-dim">Loading Model…</div>
			<p v-if="isLoadingModel && hasLoadedModel" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
				Refreshing Model…
			</p>
			<div v-else-if="modelError" class="border-b border-dimmer px-3 py-4 text-error">{{ modelError }}</div>
			<div v-else-if="model" class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Identity</h2>
					<div class="mt-2 grid gap-2 text-sz-helper sm:grid-cols-2">
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Status</span
							><span :class="model.archived ? 'text-dim' : 'text-success'">{{ model.archived ? 'Archived' : 'Active' }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Provider</span><span class="min-w-0 truncate">{{ model.provider.name }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Protocol</span><span class="font-mono">{{ model.provider.protocol.type }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Provider status</span
							><span :class="model.provider.archived ? 'text-dim' : 'text-success'">{{
								model.provider.archived ? 'Archived' : 'Active'
							}}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2 sm:col-span-2">
							<span class="text-dim">Provider model id</span><span class="min-w-0 truncate font-mono">{{ model.providerModelId }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Created</span><span>{{ formatDate(model.created.at) }}</span>
						</div>
						<div class="flex justify-between gap-3 border-b border-dimmer py-2">
							<span class="text-dim">Updated</span
							><span>{{ model.updated === null ? 'Never' : formatDate(model.updated.at) }}</span>
						</div>
					</div>
				</section>

				<UiForm class="border-b border-dimmer" @submit.prevent="saveModel()">
					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Editable metadata</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Update the user-facing Model name and capability metadata stored in Core.
						</p>
						<div class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Model name" for-id="model-name" :error="modelUpdateForm.errors.name">
								<UiInput id="model-name" v-model="modelUpdateForm.name" :invalid="!!modelUpdateForm.errors.name" />
							</UiFormGroup>
							<UiFormGroup label="Provider model id" for-id="provider-model-id">
								<UiInput id="provider-model-id" :model-value="model.providerModelId" disabled />
							</UiFormGroup>
						</div>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Capability limits</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Context window is setup metadata until token counting lands. Max output tokens are passed to provider calls as the output cap.
						</p>
						<div class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Supported inputs" for-id="model-inputs">
								<UiInput id="model-inputs" :model-value="modelUpdateForm.capabilities.inputs.join(', ')" disabled />
							</UiFormGroup>
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
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<h2 class="m-0 text-sz-subsection font-semibold">Reasoning</h2>
						<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
							Enabled levels become selectable Thinking Levels. Leave all levels disabled when provider reasoning support is unknown.
						</p>
						<div class="mt-3 border-y border-dimmer">
							<div
								v-for="level in thinkingLevels"
								:key="level"
								class="grid gap-2 border-b border-dimmer py-2 last:border-b-0 md:grid-cols-[160px_minmax(0,1fr)] md:items-center">
								<label class="flex items-center gap-2 text-sz-helper font-semibold">
									<input
										:checked="isReasoningLevelEnabled(level)"
										type="checkbox"
										@change="setReasoningLevelEnabled(level, isChecked($event))" />
									{{ thinkingLevelLabel(level) }}
								</label>
								<UiInput
									:model-value="reasoningProviderValue(level)"
									:disabled="!isReasoningLevelEnabled(level)"
									@update:model-value="setReasoningProviderValue(level, String($event))" />
							</div>
						</div>
					</section>

					<section class="border-b border-dimmer px-3 py-3">
						<div class="flex items-start justify-between gap-3">
							<div>
								<h2 class="m-0 text-sz-subsection font-semibold">Pricing</h2>
								<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
									Pricing is stored as micro-USD per million tokens and displayed here as dollars per million tokens.
								</p>
							</div>
							<UiButton type="button" variant="ghost" @click="togglePricing()">{{
								modelUpdateForm.pricing === null ? 'Configure' : 'Clear'
							}}</UiButton>
						</div>
						<div v-if="modelUpdateForm.pricing !== null" class="mt-3 grid gap-3 md:grid-cols-2">
							<UiFormGroup label="Input $ per 1M tokens" for-id="pricing-input">
								<UiInput
									id="pricing-input"
									:model-value="pricingUsdPerMillion('input')"
									@update:model-value="setPricingUsdPerMillion('input', String($event))" />
							</UiFormGroup>
							<UiFormGroup label="Output $ per 1M tokens" for-id="pricing-output">
								<UiInput
									id="pricing-output"
									:model-value="pricingUsdPerMillion('output')"
									@update:model-value="setPricingUsdPerMillion('output', String($event))" />
							</UiFormGroup>
							<UiFormGroup label="Cache read $ per 1M tokens" for-id="pricing-cache-read">
								<UiInput
									id="pricing-cache-read"
									:model-value="pricingUsdPerMillion('cacheRead')"
									@update:model-value="setPricingUsdPerMillion('cacheRead', String($event))" />
							</UiFormGroup>
							<UiFormGroup label="Cache write $ per 1M tokens" for-id="pricing-cache-write">
								<UiInput
									id="pricing-cache-write"
									:model-value="pricingUsdPerMillion('cacheWrite')"
									@update:model-value="setPricingUsdPerMillion('cacheWrite', String($event))" />
							</UiFormGroup>
						</div>
					</section>

					<section class="px-3 py-3">
						<UiButton
							type="submit"
							variant="secondary"
							:loading="isSavingModel"
							:disabled="!modelUpdateForm.valid || !modelUpdateForm.dirty">
							Save Model
						</UiButton>
						<UiText v-if="saveModelError" class="mt-2" tone="error">{{ saveModelError }}</UiText>
					</section>
				</UiForm>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Model Preflight</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Check current provider access and model reachability without storing readiness history.
					</p>
					<div class="mt-3 grid gap-2">
						<UiButton
							type="button"
							variant="secondary"
							:loading="isPreflightingModel"
							:disabled="model.archived || model.provider.archived"
							@click="preflightModel()">
							Preflight Model
						</UiButton>
						<UiCallout v-if="preflightEvidence" :tone="preflightEvidence.passed ? 'success' : 'error'">
							{{ preflightEvidence.summary }}
						</UiCallout>
						<UiText v-if="preflightModelError" tone="error">{{ preflightModelError }}</UiText>
					</div>
				</section>

				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Model lifecycle</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Archiving prevents new work from selecting this Model while preserving existing references.
					</p>
					<div class="mt-3">
						<UiButton v-if="model.archived" type="button" variant="secondary" :loading="isChangingModelLifecycle" @click="unarchiveModel()">
							Unarchive Model
						</UiButton>
						<UiButton v-else type="button" variant="ghost" :loading="isChangingModelLifecycle" @click="requestModelArchive()">
							Archive Model
						</UiButton>
					</div>
					<UiCallout v-if="isModelArchiveConfirmationVisible" class="mt-3" tone="notice">
						Archiving can make direct config references unusable until those configs change.
						<span class="mt-2 flex gap-2">
							<UiButton type="button" variant="secondary" @click="archiveModel()">Confirm archive</UiButton>
							<UiButton type="button" variant="ghost" @click="isModelArchiveConfirmationVisible = false">Cancel</UiButton>
						</span>
					</UiCallout>
					<UiText v-if="modelLifecycleError" tone="error">{{ modelLifecycleError }}</UiText>
				</section>
			</div>
		</section>

		<template v-if="model" #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">References</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Direct config references that can use this Model for future work. Inherited defaults and Agent Run transcript history are not included.
					</p>
				</section>
				<section>
					<div v-if="isLoadingReferences && !hasLoadedReferences" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						Loading references…
					</div>
					<div v-else-if="referencesError" class="border-b border-dimmer px-3 py-3 text-sz-helper text-error">{{ referencesError }}</div>
					<div v-else-if="references.length === 0" class="border-b border-dimmer px-3 py-3 text-sz-helper text-dim">
						No direct config references for this Model.
					</div>
					<div v-else>
						<NuxtLink
							v-for="reference in references"
							:key="modelReferenceKey(reference)"
							:to="modelReferenceLocation(reference)"
							class="block border-b border-dimmer px-3 py-2 text-body hover:bg-card focus-visible:bg-secondary"
							:class="reference.active ? '' : 'opacity-50'">
							<strong class="block truncate text-sz-helper font-semibold">{{ modelReferenceTitle(reference) }}</strong>
							<span class="mt-1 block truncate text-sz-micro text-dim">{{ modelReferenceSubtitle(reference) }}</span>
						</NuxtLink>
					</div>
					<p v-if="isLoadingReferences && hasLoadedReferences" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-dim">
						Refreshing references…
					</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import UiButton from '../../../../../components/ui/UiButton.vue'
import UiCallout from '../../../../../components/ui/UiCallout.vue'
import UiForm from '../../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../../components/ui/UiInput.vue'
import UiText from '../../../../../components/ui/UiText.vue'
import { useApiAction } from '../../../../../composables/action-state'
import { thinkingLevelLabel, thinkingLevelOptions } from '../../../../../composables/model-provider-options'
import { usePortfolioModelQuery, usePortfolioModelReferencesQuery } from '../../../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../../composables/selected-portfolio'
import { useServerApi, type ModelThinkingLevel, type ModelTokenPricing, type ServerApi } from '../../../../../composables/useServerApi'
import { useToasts } from '../../../../../composables/toasts'
import { ModelUpdateFormDraft } from '../../../../../forms/model'
import { formatDate } from '../../../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type PreflightEvidence = Awaited<ReturnType<ServerApi['preflightModel']>>
type ModelReference = Awaited<ReturnType<ServerApi['listModelReferences']>>[number]
type ModelReferencePurpose = ModelReference['purpose']

const route = useRoute()
const modelProviderId = computed(() => route.params.modelProviderId as string)
const modelId = computed(() => route.params.modelId as string)
const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, invalidate } = useQueryCache()
const modelUpdateForm = new ModelUpdateFormDraft()
const preflightEvidence = ref<PreflightEvidence | null>(null)
const isModelArchiveConfirmationVisible = ref(false)
const thinkingLevels = thinkingLevelOptions.map((option) => option.value)

const {
	data: model,
	isLoading: isLoadingModel,
	error: modelError,
	hasExecuted: hasLoadedModel,
} = usePortfolioModelQuery(serverApi, modelProviderId, modelId)

const {
	data: references,
	isLoading: isLoadingReferences,
	error: referencesError,
	hasExecuted: hasLoadedReferences,
} = usePortfolioModelReferencesQuery(serverApi, modelProviderId, modelId)

watch(
	model,
	(loadedModel) => {
		if (loadedModel === null) return
		modelUpdateForm.loadEntity({ name: loadedModel.name, capabilities: loadedModel.capabilities, pricing: loadedModel.pricing })
		preflightEvidence.value = null
	},
	{ immediate: true },
)

const {
	isLoading: isSavingModel,
	error: saveModelError,
	execute: saveModel,
} = useApiAction(async () => {
	const updated = await serverApi.updateModel(modelProviderId.value, modelId.value, modelUpdateForm.toModel())
	invalidateModelQueries()
	toasts.success({ title: 'Model saved.', body: updated.name })
})

const {
	isLoading: isPreflightingModel,
	error: preflightModelError,
	execute: preflightModel,
} = useApiAction(async () => {
	preflightEvidence.value = await serverApi.preflightModel(modelProviderId.value, modelId.value)
})

const {
	isLoading: isChangingModelLifecycle,
	error: modelLifecycleError,
	execute: runModelLifecycle,
} = useApiAction(async (action: 'archive' | 'unarchive') => {
	const updated =
		action === 'archive'
			? await serverApi.archiveModel(modelProviderId.value, modelId.value)
			: await serverApi.unarchiveModel(modelProviderId.value, modelId.value)
	isModelArchiveConfirmationVisible.value = false
	invalidateModelQueries()
	toasts.success({ title: action === 'archive' ? 'Model archived.' : 'Model unarchived.', body: updated.name })
})

function invalidateModelQueries(): void {
	invalidate(queryKeys.portfolio.model(portfolio.value.id, modelProviderId.value, modelId.value), { exact: true })
	invalidate(queryKeys.portfolio.modelReferences(portfolio.value.id, modelProviderId.value, modelId.value), { exact: true })
	invalidate(queryKeys.portfolio.modelProvider(portfolio.value.id, modelProviderId.value), { exact: true })
	invalidate(queryKeys.portfolio.modelProviders(portfolio.value.id), { exact: true })
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

function requestModelArchive(): void {
	isModelArchiveConfirmationVisible.value = true
}

function archiveModel(): Promise<unknown> {
	return runModelLifecycle('archive')
}

function unarchiveModel(): Promise<unknown> {
	return runModelLifecycle('unarchive')
}

type ModelReferenceReader<T> = {
	[ReferenceType in ModelReference['type']]: (reference: Extract<ModelReference, { type: ReferenceType }>) => T
}

const modelReferenceTitleByType: ModelReferenceReader<string> = {
	'portfolio-config': () => 'Portfolio Config',
	'project-config': () => 'Project Config',
	'plan-config': () => 'Plan Config',
	'delivery-config': () => 'Delivery Config',
}

const modelReferenceSubtitleByType: ModelReferenceReader<string> = {
	'portfolio-config': (reference) => `${purposeLabel(reference.purpose)} Model`,
	'project-config': (reference) => `${reference.projectTitle} · ${purposeLabel(reference.purpose)} Model`,
	'plan-config': (reference) => `${reference.planTitle} · ${purposeLabel(reference.purpose)} Model`,
	'delivery-config': (reference) => `${reference.deliveryTitle} · ${purposeLabel(reference.purpose)} Model`,
}

const modelReferenceLocationByType: ModelReferenceReader<string> = {
	'portfolio-config': () => '/portfolio-config',
	'project-config': (reference) => `/projects/${reference.projectId}/config`,
	'plan-config': (reference) => `/projects/${reference.projectId}/plans/${reference.planId}`,
	'delivery-config': (reference) => `/projects/${reference.projectId}/deliveries/${reference.deliveryId}`,
}

const modelReferenceKeyByType: ModelReferenceReader<string> = {
	'portfolio-config': (reference) => `${reference.type}:${reference.purpose}`,
	'project-config': (reference) => `${reference.type}:${reference.projectId}:${reference.purpose}`,
	'plan-config': (reference) => `${reference.type}:${reference.planId}:${reference.purpose}`,
	'delivery-config': (reference) => `${reference.type}:${reference.deliveryId}:${reference.purpose}`,
}

const purposeLabels: Record<ModelReferencePurpose, string> = {
	default: 'Default',
	planning: 'Planning',
	'revision-planning': 'Revision Planning',
	execution: 'Execution',
	'revision-execution': 'Revision Execution',
}

function modelReferenceTitle(reference: ModelReference): string {
	return modelReferenceTitleByType[reference.type](reference as never)
}

function modelReferenceSubtitle(reference: ModelReference): string {
	return modelReferenceSubtitleByType[reference.type](reference as never)
}

function modelReferenceLocation(reference: ModelReference): string {
	return modelReferenceLocationByType[reference.type](reference as never)
}

function modelReferenceKey(reference: ModelReference): string {
	return modelReferenceKeyByType[reference.type](reference as never)
}

function purposeLabel(purpose: ModelReferencePurpose): string {
	return purposeLabels[purpose]
}
</script>
