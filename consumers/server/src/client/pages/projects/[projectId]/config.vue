<template>
	<NuxtLayout name="project" :project-id="projectId">
		<UiForm @submit.prevent="saveProjectConfig()">
			<header class="border-b border-dimmer px-3 py-3">
				<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">Project Config</h1>
				<p class="m-0 mt-1 text-sz-helper text-dim">Configure Project-specific model and Delivery work overrides.</p>
			</header>

			<div v-if="isLoadingProject && !hasLoadedProject" class="border-b border-dimmer px-3 py-4 text-dim">
				Loading Project Config…
			</div>
			<div v-else-if="projectError" class="border-b border-dimmer px-3 py-4 text-error">{{ projectError }}</div>
			<div v-else class="grid gap-0">
				<section class="border-b border-dimmer px-3 py-3">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="m-0 text-sz-subsection font-semibold">Model configuration</h2>
							<p class="m-0 mt-1 text-sz-helper text-dim">
								Leave fields unset to inherit from Portfolio purpose config, then Portfolio default config.
							</p>
						</div>
						<span v-if="isLoadingProviders && hasLoadedProviders" class="text-sz-helper text-dim">Refreshing Models…</span>
					</div>

					<div v-if="providersError" class="mt-3 border-l-2 border-error py-2 pl-3 text-sz-helper text-error">
						{{ providersError }}
					</div>
					<div v-else-if="!hasActiveModels" class="mt-3 border-l-2 border-info py-2 pl-3 text-sz-helper text-dim">
						No active Models are available. Configure Models before saving Project model overrides.
						<NuxtLink class="ml-1 font-semibold text-primary hover:brightness-110" to="/models/providers"
							>Open Models.</NuxtLink
						>
					</div>
					<div v-else-if="hasInheritedModelIssue" class="mt-3 border-l-2 border-info py-2 pl-3 text-sz-helper text-dim">
						Some inherited Model selections are not configured or unavailable. You can save Project overrides now, but inherited
						fields may remain unusable until Portfolio Config or Models are updated.
					</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2">
						<UiFormGroup
							label="Planning Model"
							for-id="planning-model"
							:error="projectConfigForm.planningModelUse.errors.modelId">
							<template #label-end>
								<span class="text-sz-micro text-dim">{{ planningInheritedModelLabel }}</span>
							</template>
							<UiSelect
								id="planning-model"
								v-model="projectConfigForm.planningModelUse.modelId.value"
								:options="planningModelSelect.optionalModelOptions.value"
								placeholder="Use inherited/default"
								:invalid="!!projectConfigForm.planningModelUse.errors.modelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup
							label="Planning Thinking"
							for-id="planning-thinking"
							:error="projectConfigForm.planningModelUse.errors.thinkingLevel">
							<UiSelect
								id="planning-thinking"
								v-model="projectConfigForm.planningModelUse.thinkingLevel.value"
								:options="planningModelSelect.thinkingLevelOptions.value"
								:disabled="planningModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>

						<UiFormGroup
							label="Revision Planning Model"
							for-id="revision-planning-model"
							:error="projectConfigForm.revisionPlanningModelUse.errors.modelId">
							<template #label-end>
								<span class="text-sz-micro text-dim">{{ revisionPlanningInheritedModelLabel }}</span>
							</template>
							<UiSelect
								id="revision-planning-model"
								v-model="projectConfigForm.revisionPlanningModelUse.modelId.value"
								:options="revisionPlanningModelSelect.optionalModelOptions.value"
								placeholder="Use inherited/default"
								:invalid="!!projectConfigForm.revisionPlanningModelUse.errors.modelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup
							label="Revision Planning Thinking"
							for-id="revision-planning-thinking"
							:error="projectConfigForm.revisionPlanningModelUse.errors.thinkingLevel">
							<UiSelect
								id="revision-planning-thinking"
								v-model="projectConfigForm.revisionPlanningModelUse.thinkingLevel.value"
								:options="revisionPlanningModelSelect.thinkingLevelOptions.value"
								:disabled="revisionPlanningModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>

						<UiFormGroup
							label="Execution Model"
							for-id="execution-model"
							:error="projectConfigForm.executionModelUse.errors.modelId">
							<template #label-end>
								<span class="text-sz-micro text-dim">{{ executionInheritedModelLabel }}</span>
							</template>
							<UiSelect
								id="execution-model"
								v-model="projectConfigForm.executionModelUse.modelId.value"
								:options="executionModelSelect.optionalModelOptions.value"
								placeholder="Use inherited/default"
								:invalid="!!projectConfigForm.executionModelUse.errors.modelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup
							label="Execution Thinking"
							for-id="execution-thinking"
							:error="projectConfigForm.executionModelUse.errors.thinkingLevel">
							<UiSelect
								id="execution-thinking"
								v-model="projectConfigForm.executionModelUse.thinkingLevel.value"
								:options="executionModelSelect.thinkingLevelOptions.value"
								:disabled="executionModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>

						<UiFormGroup
							label="Revision Execution Model"
							for-id="revision-execution-model"
							:error="projectConfigForm.revisionExecutionModelUse.errors.modelId">
							<template #label-end>
								<span class="text-sz-micro text-dim">{{ revisionExecutionInheritedModelLabel }}</span>
							</template>
							<UiSelect
								id="revision-execution-model"
								v-model="projectConfigForm.revisionExecutionModelUse.modelId.value"
								:options="revisionExecutionModelSelect.optionalModelOptions.value"
								placeholder="Use inherited/default"
								:invalid="!!projectConfigForm.revisionExecutionModelUse.errors.modelId"
								:disabled="!hasActiveModels" />
						</UiFormGroup>
						<UiFormGroup
							label="Revision Execution Thinking"
							for-id="revision-execution-thinking"
							:error="projectConfigForm.revisionExecutionModelUse.errors.thinkingLevel">
							<UiSelect
								id="revision-execution-thinking"
								v-model="projectConfigForm.revisionExecutionModelUse.thinkingLevel.value"
								:options="revisionExecutionModelSelect.thinkingLevelOptions.value"
								:disabled="revisionExecutionModelSelect.thinkingLevelDisabled.value" />
						</UiFormGroup>
					</div>
				</section>

				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-subsection font-semibold">Delivery work configuration</h2>
					<p class="m-0 mt-1 text-sz-helper text-dim">{{ inheritedWorkLabel }}</p>
					<UiCheckbox
						v-model="overridesWorkModel"
						class="mt-3 font-semibold"
						description="When enabled, this Project stores complete Delivery work settings instead of inheriting Portfolio settings.">
						Override Delivery work config
					</UiCheckbox>

					<div v-if="projectConfigForm.overridesWork" class="mt-4 grid gap-3 md:grid-cols-3">
						<UiFormGroup label="Slice slots" for-id="slice-slots" :error="projectConfigForm.errors.maxProcessableSliceSlots">
							<UiInput
								id="slice-slots"
								v-model="projectConfigForm.maxProcessableSliceSlots"
								type="number"
								:min="1"
								:invalid="!!projectConfigForm.errors.maxProcessableSliceSlots" />
						</UiFormGroup>
						<UiFormGroup
							label="Correction retries"
							for-id="correction-retries"
							:error="projectConfigForm.errors.maxCorrectionRetriesPerFailure">
							<UiInput
								id="correction-retries"
								v-model="projectConfigForm.maxCorrectionRetriesPerFailure"
								type="number"
								:min="0"
								:invalid="!!projectConfigForm.errors.maxCorrectionRetriesPerFailure" />
						</UiFormGroup>
						<UiFormGroup label="Model timeout ms" for-id="model-timeout" :error="projectConfigForm.errors.modelTimeoutMs">
							<UiInput
								id="model-timeout"
								v-model="projectConfigForm.modelTimeoutMs"
								type="number"
								:min="1"
								:invalid="!!projectConfigForm.errors.modelTimeoutMs" />
						</UiFormGroup>
					</div>
				</section>

				<p v-if="saveProjectConfigError" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-error">
					{{ saveProjectConfigError }}
				</p>

				<footer class="flex flex-wrap items-center gap-3 px-3 py-3">
					<UiButton type="submit" :loading="isSavingProjectConfig" :disabled="!canSaveProjectConfig">Save Config</UiButton>
					<UiButton type="button" variant="ghost" :disabled="!canClearProjectOverrides" @click="clearProjectOverrides()">
						Clear Project overrides
					</UiButton>
				</footer>
			</div>
		</UiForm>

		<template #right>
			<aside>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Scope</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Project Config narrows Portfolio defaults for this Project. Plan and Delivery config can still override narrower
						work.
					</p>
				</section>
				<section class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Setup</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						Configure active Models before selecting Project overrides. Portfolio Config remains the fallback when fields are
						unset.
					</p>
					<div class="mt-2 flex flex-wrap gap-3 text-sz-helper">
						<NuxtLink class="font-semibold text-primary hover:brightness-110" to="/portfolio-config">Portfolio Config</NuxtLink>
						<NuxtLink class="font-semibold text-primary hover:brightness-110" to="/models/providers">Models</NuxtLink>
					</div>
				</section>
				<section v-if="lastConfiguredLabel" class="border-b border-dimmer px-3 py-3">
					<h2 class="m-0 text-sz-helper font-semibold">Last configured</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">{{ lastConfiguredLabel }}</p>
				</section>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../components/ui/UiButton.vue'
import UiCheckbox from '../../../components/ui/UiCheckbox.vue'
import UiForm from '../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../components/ui/UiInput.vue'
import UiSelect from '../../../components/ui/UiSelect.vue'
import { useProjectConfig } from '../../../composables/portfolio/project/config'
import type { DeliveryWorkConfigInput, ModelUseConfig, ServerApi } from '../../../composables/core/server-api'
import { modelOptionLabel, thinkingLevelLabel } from '../../../utils/model-provider-options'
import { formatDate } from '../../../utils/time'

definePageMeta({ middleware: ['has-selection'] })

type PortfolioConfig = Awaited<ReturnType<ServerApi['getPortfolioConfig']>>
type ProjectModelPurpose = 'planning' | 'revisionPlanning' | 'execution' | 'revisionExecution'
type InheritedModelState = { type: 'ready'; modelUse: ModelUseConfig } | { type: 'not-configured' } | { type: 'unavailable' }

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const {
	project,
	isLoadingProject,
	projectError,
	hasLoadedProject,
	portfolioConfig,
	inheritedWorkConfig,
	projectConfigForm,
	planningModelSelect,
	revisionPlanningModelSelect,
	executionModelSelect,
	revisionExecutionModelSelect,
	isSavingProjectConfig,
	saveProjectConfigError,
	saveProjectConfig,
	enableWorkOverride,
	clearProjectOverrides,
} = useProjectConfig(projectId)
const activeModelOptionGroups = planningModelSelect.activeModelOptionGroups
const activeModelIds = planningModelSelect.activeModelIds
const hasActiveModels = planningModelSelect.hasActiveModels
const isLoadingProviders = planningModelSelect.isLoadingProviders
const providersError = planningModelSelect.providersError
const hasLoadedProviders = planningModelSelect.hasLoadedProviders
const overridesWorkModel = computed({
	get: () => projectConfigForm.overridesWork,
	set: (value: boolean) => {
		if (value) enableWorkOverride()
		else projectConfigForm.overridesWork = false
	},
})
const planningInheritedModelLabel = computed(() => inheritedModelLabel('planning'))
const revisionPlanningInheritedModelLabel = computed(() => inheritedModelLabel('revisionPlanning'))
const executionInheritedModelLabel = computed(() => inheritedModelLabel('execution'))
const revisionExecutionInheritedModelLabel = computed(() => inheritedModelLabel('revisionExecution'))
const hasInheritedModelIssue = computed(() =>
	(['planning', 'revisionPlanning', 'execution', 'revisionExecution'] as ProjectModelPurpose[]).some(
		(purpose) => inheritedModelState(purpose).type !== 'ready',
	),
)
const inheritedWorkLabel = computed(() => `${inheritedWorkSource()}: ${workSummary(inheritedWorkConfig.value)}`)
const hasProjectOverrides = computed(
	() =>
		[
			projectConfigForm.planningModelUse.modelId.value,
			projectConfigForm.revisionPlanningModelUse.modelId.value,
			projectConfigForm.executionModelUse.modelId.value,
			projectConfigForm.revisionExecutionModelUse.modelId.value,
		].some((modelId) => modelId !== null) || projectConfigForm.overridesWork,
)
const canClearProjectOverrides = computed(() => hasProjectOverrides.value)
const canSaveProjectConfig = computed(() => projectConfigForm.valid && projectConfigForm.dirty && !isSavingProjectConfig.value)
const lastConfiguredLabel = computed(() => {
	const configured = project.value?.config?.configured ?? null
	return configured === null ? '' : formatDate(configured.at)
})

function inheritedModelLabel(purpose: ProjectModelPurpose): string {
	const state = inheritedModelState(purpose)
	if (state.type === 'not-configured') return 'Inherited: not configured'
	if (state.type === 'unavailable') return 'Inherited: unavailable'
	return `Inherited: ${modelOptionLabel(activeModelOptionGroups.value, state.modelUse.modelId)} · ${thinkingLevelLabel(state.modelUse.thinkingLevel)}`
}

function inheritedModelState(purpose: ProjectModelPurpose): InheritedModelState {
	const modelUse = inheritedModelUse(portfolioConfig.value, purpose)
	if (modelUse === null) return { type: 'not-configured' }
	return activeModelIds.value.has(modelUse.modelId) ? { type: 'ready', modelUse } : { type: 'unavailable' }
}

function inheritedModelUse(config: PortfolioConfig, purpose: ProjectModelPurpose): ModelUseConfig | null {
	if (config === null) return null
	return config.value.model[purpose] ?? config.value.model.default
}

function inheritedWorkSource(): string {
	return portfolioConfig.value === null || portfolioConfig.value.value.work === null ? 'Inherited defaults' : 'Inherited from Portfolio'
}

function workSummary(work: DeliveryWorkConfigInput): string {
	return `${work.maxProcessableSliceSlots} / ${work.maxCorrectionRetriesPerFailure} / ${work.modelTimeoutMs}ms`
}
</script>
