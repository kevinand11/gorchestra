<template>
	<NuxtLayout name="portfolio">
		<UiForm @submit.prevent="saveConfig()">
			<header class="border-b border-dimmer px-3 py-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Portfolio Config</h1>
						<p class="m-0 mt-1 text-sz-helper text-dim">Set selected-Portfolio model defaults and Delivery work behavior.</p>
					</div>
					<UiButton type="submit" :loading="isSavingConfig" :disabled="!canSaveConfig">Save Config</UiButton>
				</div>
			</header>

			<div v-if="isLoadingConfig && !hasLoadedConfig" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Portfolio Config…
			</div>
			<div v-else-if="configError" class="border-b border-dimmer px-3 py-4 text-error">{{ configError }}</div>
			<div v-else class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="m-0 text-sz-subsection font-semibold">Model configuration</h2>
							<p class="m-0 mt-1 text-sz-helper text-dim">Purpose-specific fields inherit from Default Model when unset.</p>
						</div>
						<span v-if="isLoadingProviders && hasLoadedProviders" class="text-sz-helper text-dim">Refreshing Models…</span>
					</div>

					<div v-if="providersError" class="mt-3 border-l-2 border-error py-2 pl-3 text-sz-helper text-error">
						{{ providersError }}
					</div>
					<div v-else-if="!hasActiveModels" class="mt-3">
						<UiCallout tone="notice">
							No active Models are available. Create an active Model before saving Portfolio Config.
							<NuxtLink class="ml-1 font-semibold text-primary hover:brightness-110" to="/models/providers"
								>Go to Models.</NuxtLink
							>
						</UiCallout>
					</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2">
						<UiFormGroup label="Default Model" for-id="default-model" :error="configForm.errors.defaultModelId">
							<UiSelect
								id="default-model"
								v-model="configForm.defaultModelId"
								:options="activeModelOptionGroups"
								placeholder="Select default Model"
								:invalid="!!configForm.errors.defaultModelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Planning Model" for-id="planning-model">
							<UiSelect
								id="planning-model"
								v-model="configForm.planningModelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Revision Planning Model" for-id="revision-planning-model">
							<UiSelect
								id="revision-planning-model"
								v-model="configForm.revisionPlanningModelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Execution Model" for-id="execution-model">
							<UiSelect
								id="execution-model"
								v-model="configForm.executionModelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Revision Execution Model" for-id="revision-execution-model">
							<UiSelect
								id="revision-execution-model"
								v-model="configForm.revisionExecutionModelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Delivery work configuration</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">
						These values guide runtime Delivery work when narrower config does not override them.
					</p>
					<div class="mt-4 grid gap-3 md:grid-cols-3">
						<UiFormGroup label="Slice slots" for-id="slice-slots" :error="configForm.errors.maxProcessableSliceSlots">
							<UiInput
								id="slice-slots"
								type="number"
								:min="1"
								:model-value="configForm.maxProcessableSliceSlots"
								:invalid="!!configForm.errors.maxProcessableSliceSlots"
								@update:model-value="configForm.maxProcessableSliceSlots = numberFieldValue($event)" />
						</UiFormGroup>
						<UiFormGroup
							label="Correction retries"
							for-id="correction-retries"
							:error="configForm.errors.maxCorrectionRetriesPerFailure">
							<UiInput
								id="correction-retries"
								type="number"
								:min="0"
								:model-value="configForm.maxCorrectionRetriesPerFailure"
								:invalid="!!configForm.errors.maxCorrectionRetriesPerFailure"
								@update:model-value="configForm.maxCorrectionRetriesPerFailure = numberFieldValue($event)" />
						</UiFormGroup>
						<UiFormGroup label="Model timeout ms" for-id="model-timeout" :error="configForm.errors.modelTimeoutMs">
							<UiInput
								id="model-timeout"
								type="number"
								:min="1"
								:model-value="configForm.modelTimeoutMs"
								:invalid="!!configForm.errors.modelTimeoutMs"
								@update:model-value="configForm.modelTimeoutMs = numberFieldValue($event)" />
						</UiFormGroup>
					</div>
				</section>

				<p v-if="saveConfigError" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-error">{{ saveConfigError }}</p>
			</div>
		</UiForm>

		<template #right>
			<aside class="grid gap-4 p-3">
				<UiCallout>
					Portfolio Config belongs to the Core Portfolio and applies across Projects unless Project, Plan, or Delivery config
					overrides it.
				</UiCallout>
				<UiCallout tone="notice">
					Model Preflight is recommended before selecting a Model here, but Portfolio Config can reference any active Model.
				</UiCallout>
				<div class="border-t border-dimmer pt-3">
					<h2 class="m-0 text-sz-helper font-semibold">Missing setup?</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">Configure Model Providers and Models before saving defaults.</p>
					<NuxtLink
						class="mt-2 inline-flex text-sz-helper font-semibold text-primary hover:brightness-110"
						to="/models/providers">
						Open Models
					</NuxtLink>
				</div>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import UiButton from '../components/ui/UiButton.vue'
import UiCallout from '../components/ui/UiCallout.vue'
import UiForm from '../components/ui/UiForm.vue'
import UiFormGroup from '../components/ui/UiFormGroup.vue'
import UiInput from '../components/ui/UiInput.vue'
import UiSelect from '../components/ui/UiSelect.vue'
import { useApiAction } from '../composables/action-state'
import { activeModelOptionGroupsFromProviders } from '../composables/model-provider-options'
import { usePortfolioConfigQuery, usePortfolioModelProvidersQuery } from '../composables/portfolio-resource-queries'
import { useQueryCache } from '../composables/query-cache'
import { useSelectedPortfolio } from '../composables/selected-portfolio'
import { useServerApi } from '../composables/useServerApi'
import { PortfolioConfigFormDraft } from '../forms/portfolio-config'
import { useToasts } from '../composables/toasts'

definePageMeta({ middleware: ['has-selection'] })

const serverApi = useServerApi()
const toasts = useToasts()
const { portfolio } = useSelectedPortfolio()
const { queryKeys, set, invalidate } = useQueryCache()
const configForm = new PortfolioConfigFormDraft()

const {
	data: portfolioConfig,
	isLoading: isLoadingConfig,
	error: configError,
	hasExecuted: hasLoadedConfig,
} = usePortfolioConfigQuery(serverApi)
const {
	data: providers,
	isLoading: isLoadingProviders,
	error: providersError,
	hasExecuted: hasLoadedProviders,
} = usePortfolioModelProvidersQuery(serverApi)

const activeModelOptionGroups = computed(() => activeModelOptionGroupsFromProviders(providers.value))
const optionalModelOptions = computed(() => [{ value: '', label: 'Use default' }, ...activeModelOptionGroups.value])
const hasActiveModels = computed(() => activeModelOptionGroups.value.length > 0)
const canSaveConfig = computed(
	() => configForm.valid && hasActiveModels.value && configForm.defaultModelId.trim().length > 0 && !isSavingConfig.value,
)

watch(
	portfolioConfig,
	(record) => {
		if (record !== null) configForm.loadEntity({ config: record.value })
	},
	{ immediate: true },
)

const {
	isLoading: isSavingConfig,
	error: saveConfigError,
	execute: saveConfig,
} = useApiAction(async () => {
	const saved = await serverApi.setPortfolioConfig(configForm.toModel())
	set(queryKeys.portfolio.portfolioConfig(portfolio.value.id), saved)
	invalidate(queryKeys.portfolio.portfolioConfig(portfolio.value.id), { exact: true })
	toasts.success({ title: 'Portfolio Config saved.' })
})

function numberFieldValue(value: string | number): number {
	return typeof value === 'number' ? value : Number(value)
}
</script>
