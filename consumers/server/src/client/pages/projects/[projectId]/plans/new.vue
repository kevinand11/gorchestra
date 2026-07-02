<template>
	<NuxtLayout name="project" :project-id="projectId">
		<UiForm @submit.prevent="createPlan()">
			<header class="border-b border-dimmer px-3 py-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 class="m-0 text-sz-section font-semibold tracking-[-0.01em]">New Plan</h1>
						<p class="m-0 mt-1 text-sz-helper text-dim">Start Planning with an initial operator message and model selection.</p>
					</div>
					<UiButton type="submit" :loading="isCreatingPlan" :disabled="!canCreatePlan">Create Plan</UiButton>
				</div>
			</header>

			<section class="border-b border-dimmer px-3 py-3">
				<h2 class="m-0 text-sz-subsection font-semibold">Plan details</h2>
				<div class="mt-3 grid gap-3">
					<UiFormGroup label="Plan title" for-id="plan-title" :error="planCreationForm.errors.title">
						<UiInput
							id="plan-title"
							v-model="planCreationForm.title"
							required
							placeholder="Plan Repository onboarding"
							:invalid="!!planCreationForm.errors.title" />
					</UiFormGroup>
					<UiFormGroup
						label="Initial planning message"
						for-id="plan-initial-message"
						:error="planCreationForm.errors.initialMessage">
						<UiTextarea
							id="plan-initial-message"
							v-model="planCreationForm.initialMessage"
							required
							rows="7"
							placeholder="Describe what you want the planning agent to explore."
							:invalid="!!planCreationForm.errors.initialMessage" />
					</UiFormGroup>
				</div>
			</section>

			<section class="border-b border-dimmer px-3 py-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="m-0 text-sz-subsection font-semibold">Planning Model</h2>
						<p class="m-0 mt-1 text-sz-helper text-dim">Leave unset to inherit Project or Portfolio model configuration.</p>
					</div>
					<span v-if="inheritedPlanningModelLabel" class="text-sz-helper text-dim"
						>Inherited: {{ inheritedPlanningModelLabel }}</span
					>
				</div>

				<div v-if="providersError" class="mt-3 border-l-2 border-error py-2 pl-3 text-sz-helper text-error">
					{{ providersError }}
				</div>
				<div v-else-if="!hasActiveModels" class="mt-3">
					<UiCallout tone="notice">
						No active Models are available. Create a Model before creating a Plan.
						<NuxtLink class="ml-1 font-semibold text-primary hover:brightness-110" to="/models/providers"
							>Go to Models.</NuxtLink
						>
					</UiCallout>
				</div>
				<UiCallout v-else-if="requiresPlanModelOverride" class="mt-3" tone="notice">
					No active inherited Planning Model is configured. Select a Plan-level Planning Model below.
				</UiCallout>

				<div class="mt-4 grid gap-3 md:grid-cols-2">
					<UiFormGroup label="Planning Model" for-id="planning-model">
						<UiSelect
							id="planning-model"
							v-model="planCreationForm.planningModelUse.modelId"
							:options="planningModelOptions"
							placeholder="Use inherited/default"
							search-placeholder="Search Models…"
							empty-label="No active Models available"
							:always-open="true"
							:disabled="!hasActiveModels" />
					</UiFormGroup>
					<UiFormGroup label="Planning Thinking" for-id="planning-thinking">
						<UiSelect
							id="planning-thinking"
							v-model="planCreationForm.planningModelUse.thinkingLevel"
							:options="planningModelSelect.thinkingLevelOptions.value"
							:disabled="planningModelSelect.thinkingLevelDisabled.value" />
					</UiFormGroup>
				</div>
			</section>

			<p v-if="createPlanError" class="m-0 border-b border-dimmer px-3 py-2 text-sz-helper text-error">{{ createPlanError }}</p>
		</UiForm>

		<template #right>
			<aside class="grid gap-4 p-3">
				<UiCallout>
					Creating a Plan writes the Plan, creates its Planning Agent Run, records the first input message, and dispatches the
					Agent Run.
				</UiCallout>
				<UiCallout tone="notice">
					Plan Config is immutable after creation. Use the Plan-level override only when this Plan should use a different Planning
					Model.
				</UiCallout>
				<div class="border-t border-dimmer pt-3">
					<h2 class="m-0 text-sz-helper font-semibold">Model setup</h2>
					<p class="m-0 mt-1 text-sz-helper leading-5 text-dim">
						If inherited model resolution fails, select an active Plan-level Planning Model or configure Portfolio Config.
					</p>
					<div class="mt-2 flex flex-wrap gap-3 text-sz-helper">
						<NuxtLink class="font-semibold text-primary hover:brightness-110" to="/models/providers">Models</NuxtLink>
						<NuxtLink class="font-semibold text-primary hover:brightness-110" to="/portfolio-config">Portfolio Config</NuxtLink>
					</div>
				</div>
			</aside>
		</template>
	</NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import UiButton from '../../../../components/ui/UiButton.vue'
import UiCallout from '../../../../components/ui/UiCallout.vue'
import UiForm from '../../../../components/ui/UiForm.vue'
import UiFormGroup from '../../../../components/ui/UiFormGroup.vue'
import UiInput from '../../../../components/ui/UiInput.vue'
import UiSelect from '../../../../components/ui/UiSelect.vue'
import UiTextarea from '../../../../components/ui/UiTextarea.vue'
import { useApiAction } from '../../../../composables/action-state'
import { modelOptionLabel, thinkingLevelLabel } from '../../../../composables/model-provider-options'
import { usePortfolioConfigQuery, usePortfolioProjectQuery } from '../../../../composables/portfolio-resource-queries'
import { useQueryCache } from '../../../../composables/query-cache'
import { useSelectedPortfolio } from '../../../../composables/selected-portfolio'
import { useServerApi, type ModelUseConfig, type ServerApi } from '../../../../composables/useServerApi'
import { useSelectModel } from '../../../../composables/use-select-model'
import { useToasts } from '../../../../composables/toasts'
import { PlanCreationFormDraft } from '../../../../forms/plan'

definePageMeta({ middleware: ['has-selection'] })

type ProjectDetails = Awaited<ReturnType<ServerApi['getProject']>>
type ProjectConfigRecord = ProjectDetails['config']
type ProjectConfigValue = NonNullable<NonNullable<ProjectConfigRecord>['value']>
type ProjectModelConfig = ProjectConfigValue['model']
type PortfolioConfig = Awaited<ReturnType<ServerApi['getPortfolioConfig']>>

const route = useRoute()
const projectId = computed(() => route.params.projectId as string)
const { portfolio } = useSelectedPortfolio()
const serverApi = useServerApi()
const toasts = useToasts()
const queryCache = useQueryCache()
const { queryKeys } = queryCache
const planCreationForm = new PlanCreationFormDraft()

const { data: project } = usePortfolioProjectQuery(serverApi, projectId)
const { data: portfolioConfig } = usePortfolioConfigQuery(serverApi)
const planningModelSelect = useSelectModel(planCreationForm.planningModelUse, { optionalLabel: 'Use inherited/default' })

const activeModelOptionGroups = planningModelSelect.activeModelOptionGroups
const planningModelOptions = planningModelSelect.optionalModelOptions
const activeModelIds = planningModelSelect.activeModelIds
const hasActiveModels = planningModelSelect.hasActiveModels
const providersError = planningModelSelect.providersError
const inheritedPlanningModelUse = computed(() => planningModelUseFromConfig(project.value, portfolioConfig.value))
const inheritedPlanningModelId = computed(() => inheritedPlanningModelUse.value?.modelId ?? null)
const inheritedPlanningModelIsActive = computed(
	() => inheritedPlanningModelId.value !== null && activeModelIds.value.has(inheritedPlanningModelId.value),
)
const inheritedPlanningModelLabel = computed(() => activeInheritedModelLabel())
const requiresPlanModelOverride = computed(() => !inheritedPlanningModelIsActive.value)
const hasPlanModelOverride = computed(() => planCreationForm.planningModelUse.modelId.trim().length > 0)
const hasRequiredPlanningModel = computed(() => !requiresPlanModelOverride.value || hasPlanModelOverride.value)
const canCreatePlan = computed(() =>
	[planCreationForm.valid, hasActiveModels.value, hasRequiredPlanningModel.value, !isCreatingPlan.value].every(Boolean),
)

const {
	isLoading: isCreatingPlan,
	error: createPlanError,
	execute: createPlan,
} = useApiAction(async () => {
	const plan = await serverApi.createPlan(projectId.value, planCreationForm.toModel())
	queryCache.set(queryKeys.portfolio.plan(portfolio.value.id, projectId.value, plan.id), plan)
	queryCache.invalidate(queryKeys.portfolio.plans(portfolio.value.id, projectId.value), { exact: true })
	toasts.success({ title: 'Plan created.', body: plan.title })
	await navigateTo(`/projects/${projectId.value}/plans/${plan.id}`)
})

function planningModelUseFromConfig(projectDetails: ProjectDetails | null, config: PortfolioConfig): ModelUseConfig | null {
	return firstPresent([projectPlanningModelUse(projectDetails), portfolioPlanningModelUse(config), portfolioDefaultModelUse(config)])
}

function firstPresent(values: Array<ModelUseConfig | null>): ModelUseConfig | null {
	return values.find((value): value is ModelUseConfig => value !== null) ?? null
}

function projectPlanningModelUse(projectDetails: ProjectDetails | null): ModelUseConfig | null {
	return projectDetails === null ? null : projectConfigPlanningModelUse(projectDetails.config)
}

function projectConfigPlanningModelUse(configRecord: ProjectConfigRecord): ModelUseConfig | null {
	const config = projectConfigValue(configRecord)
	return config === null ? null : projectModelPlanningModelUse(config.model)
}

function projectConfigValue(configRecord: ProjectConfigRecord): ProjectConfigValue | null {
	return configRecord === null ? null : configRecord.value
}

function projectModelPlanningModelUse(model: ProjectModelConfig): ModelUseConfig | null {
	return model === null ? null : model.planning
}

function portfolioPlanningModelUse(config: PortfolioConfig): ModelUseConfig | null {
	return config === null ? null : config.value.model.planning
}

function portfolioDefaultModelUse(config: PortfolioConfig): ModelUseConfig | null {
	return config === null ? null : config.value.model.default
}

function activeInheritedModelLabel(): string {
	const modelUse = inheritedPlanningModelUse.value
	return inheritedPlanningModelIsActive.value && modelUse !== null
		? `${modelOptionLabel(activeModelOptionGroups.value, modelUse.modelId)} · ${thinkingLevelLabel(modelUse.thinkingLevel)}`
		: ''
}
</script>
