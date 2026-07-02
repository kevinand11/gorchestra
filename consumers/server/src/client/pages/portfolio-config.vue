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
						<UiFormGroup label="Default Model" for-id="default-model" :error="configForm.defaultModelUse.errors.modelId">
							<UiSelect
								id="default-model"
								v-model="configForm.defaultModelUse.modelId"
								:options="activeModelOptionGroups"
								placeholder="Select default Model"
								:invalid="!!configForm.defaultModelUse.errors.modelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Default Thinking" for-id="default-thinking">
							<UiSelect
								id="default-thinking"
								v-model="configForm.defaultModelUse.thinkingLevel"
								:options="defaultModelSelect.thinkingLevelOptions.value"
								:disabled="defaultModelSelect.thinkingLevelOptions.value.length === 0" />
						</UiFormGroup>
						<UiFormGroup label="Planning Model" for-id="planning-model">
							<UiSelect
								id="planning-model"
								v-model="configForm.planningModelUse.modelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Planning Thinking" for-id="planning-thinking">
							<UiSelect
								id="planning-thinking"
								v-model="configForm.planningModelUse.thinkingLevel"
								:options="planningModelSelect.thinkingLevelOptions.value"
								:disabled="planningModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>
						<UiFormGroup label="Revision Planning Model" for-id="revision-planning-model">
							<UiSelect
								id="revision-planning-model"
								v-model="configForm.revisionPlanningModelUse.modelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Revision Planning Thinking" for-id="revision-planning-thinking">
							<UiSelect
								id="revision-planning-thinking"
								v-model="configForm.revisionPlanningModelUse.thinkingLevel"
								:options="revisionPlanningModelSelect.thinkingLevelOptions.value"
								:disabled="revisionPlanningModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>
						<UiFormGroup label="Execution Model" for-id="execution-model">
							<UiSelect
								id="execution-model"
								v-model="configForm.executionModelUse.modelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Execution Thinking" for-id="execution-thinking">
							<UiSelect
								id="execution-thinking"
								v-model="configForm.executionModelUse.thinkingLevel"
								:options="executionModelSelect.thinkingLevelOptions.value"
								:disabled="executionModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>
						<UiFormGroup label="Revision Execution Model" for-id="revision-execution-model">
							<UiSelect
								id="revision-execution-model"
								v-model="configForm.revisionExecutionModelUse.modelId"
								:options="optionalModelOptions"
								placeholder="Use default"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup label="Revision Execution Thinking" for-id="revision-execution-thinking">
							<UiSelect
								id="revision-execution-thinking"
								v-model="configForm.revisionExecutionModelUse.thinkingLevel"
								:options="revisionExecutionModelSelect.thinkingLevelOptions.value"
								:disabled="revisionExecutionModelSelect.thinkingLevelDisabled.value" />
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
								v-model="configForm.maxProcessableSliceSlots"
								type="number"
								:min="1"
								:invalid="!!configForm.errors.maxProcessableSliceSlots" />
						</UiFormGroup>
						<UiFormGroup
							label="Correction retries"
							for-id="correction-retries"
							:error="configForm.errors.maxCorrectionRetriesPerFailure">
							<UiInput
								id="correction-retries"
								v-model="configForm.maxCorrectionRetriesPerFailure"
								type="number"
								:min="0"
								:invalid="!!configForm.errors.maxCorrectionRetriesPerFailure" />
						</UiFormGroup>
						<UiFormGroup label="Model timeout ms" for-id="model-timeout" :error="configForm.errors.modelTimeoutMs">
							<UiInput
								id="model-timeout"
								v-model="configForm.modelTimeoutMs"
								type="number"
								:min="1"
								:invalid="!!configForm.errors.modelTimeoutMs" />
						</UiFormGroup>
					</div>
				</section>

				<p v-if="saveConfigError" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-error">{{ saveConfigError }}</p>
			</div>
		</UiForm>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Scope</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Portfolio Config belongs to the Core Portfolio and applies across Projects unless Project, Plan, or Delivery config
						overrides it.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Preflight</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Model Preflight is recommended before selecting a Model here, but Portfolio Config can reference any active Model.
					</p>
				</section>
				<section class="px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Missing setup?</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">Configure Model Providers and Models before saving defaults.</p>
					<NuxtLink
						class="mt-2 inline-flex text-sz-helper font-semibold text-primary hover:brightness-110"
						to="/models/providers">
						Open Models
					</NuxtLink>
				</section>
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
import { usePortfolioConfigQuery } from '../composables/portfolio-resource-queries'
import { useQueryCache } from '../composables/query-cache'
import { useSelectedPortfolio } from '../composables/selected-portfolio'
import { useServerApi } from '../composables/useServerApi'
import { useSelectModel } from '../composables/use-select-model'
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
const defaultModelSelect = useSelectModel(configForm.defaultModelUse)
const planningModelSelect = useSelectModel(configForm.planningModelUse, { providers: defaultModelSelect.providers })
const revisionPlanningModelSelect = useSelectModel(configForm.revisionPlanningModelUse, { providers: defaultModelSelect.providers })
const executionModelSelect = useSelectModel(configForm.executionModelUse, { providers: defaultModelSelect.providers })
const revisionExecutionModelSelect = useSelectModel(configForm.revisionExecutionModelUse, { providers: defaultModelSelect.providers })

const activeModelOptionGroups = defaultModelSelect.activeModelOptionGroups
const optionalModelOptions = defaultModelSelect.optionalModelOptions
const hasActiveModels = defaultModelSelect.hasActiveModels
const isLoadingProviders = defaultModelSelect.isLoadingProviders
const providersError = defaultModelSelect.providersError
const hasLoadedProviders = defaultModelSelect.hasLoadedProviders
const canSaveConfig = computed(() => configForm.valid && !isSavingConfig.value)

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
</script>
